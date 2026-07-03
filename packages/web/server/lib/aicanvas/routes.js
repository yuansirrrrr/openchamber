const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8777;
const PLUGIN_DIR_NAMES = ['ai-canvaspro', 'ai-canvaspro-plugin'];

const isLoopbackHost = (host) => host === '127.0.0.1' || host === 'localhost' || host === '::1';

const normalizePort = (value) => {
  const port = Number.parseInt(String(value ?? DEFAULT_PORT), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
};

const normalizeHost = (value) => {
  const host = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_HOST;
  return isLoopbackHost(host) ? host : DEFAULT_HOST;
};

const getHomeDir = (os, processLike) => {
  try {
    const home = typeof os?.homedir === 'function' ? os.homedir() : '';
    if (home) return home;
  } catch {
  }
  return processLike.env.USERPROFILE || processLike.env.HOME || '';
};

const getOpenCodeConfigPath = (path, os, processLike) => {
  const explicit = processLike.env.OPENCODE_CONFIG || processLike.env.OPENCODE_CONFIG_PATH;
  if (explicit) return path.resolve(explicit);
  const home = getHomeDir(os, processLike);
  return home ? path.join(home, '.config', 'opencode', 'opencode.json') : '';
};

const readJsonFile = (fs, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const normalizePluginEntries = (config) => {
  const entries = config?.plugin;
  if (Array.isArray(entries)) return entries.filter((entry) => typeof entry === 'string');
  if (typeof entries === 'string') return [entries];
  return [];
};

const resolveConfiguredPluginPath = (fs, path, os, processLike) => {
  const configPath = getOpenCodeConfigPath(path, os, processLike);
  const config = readJsonFile(fs, configPath);
  const configDir = configPath ? path.dirname(configPath) : '';
  const entries = normalizePluginEntries(config);

  for (const entry of entries) {
    const resolved = path.isAbsolute(entry)
      ? path.normalize(entry)
      : path.resolve(configDir, entry);
    const normalized = resolved.replace(/\\/g, '/').toLowerCase();
    if (
      path.basename(resolved).toLowerCase() === 'ai-canvaspro.js'
      || normalized.includes('/ai-canvaspro/')
      || normalized.includes('/ai-canvaspro-plugin/')
      || normalized.endsWith('/ai-canvaspro.js')
    ) {
      return resolved;
    }
  }

  return null;
};

const getOpenCodePluginsDir = (path, os, processLike) => {
  const home = getHomeDir(os, processLike);
  return home ? path.join(home, '.config', 'opencode', 'plugins') : '';
};

const findInstalledPluginPath = (fs, path, os, processLike) => {
  const pluginsDir = getOpenCodePluginsDir(path, os, processLike);
  if (!pluginsDir) return null;

  for (const name of PLUGIN_DIR_NAMES) {
    const pluginPath = path.join(pluginsDir, name, 'ai-canvaspro.js');
    if (fs.existsSync(pluginPath)) return pluginPath;
  }

  try {
    if (!fs.existsSync(pluginsDir)) return null;
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = path.join(pluginsDir, entry.name, 'ai-canvaspro.js');
      if (fs.existsSync(pluginPath)) return pluginPath;
    }
  } catch {
  }

  return null;
};

const hasRuntimeServer = (fs, path, runtimeRoot) => (
  Boolean(runtimeRoot) && fs.existsSync(path.join(runtimeRoot, 'server.py'))
);

const findRuntimeRootNearPlugin = (fs, path, pluginPath) => {
  if (!pluginPath) return null;
  const pluginDir = path.dirname(pluginPath);
  const colocatedRuntime = path.join(pluginDir, 'runtime');
  if (hasRuntimeServer(fs, path, colocatedRuntime)) return colocatedRuntime;

  try {
    if (!fs.existsSync(pluginDir)) return null;
    const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runtimeRoot = path.join(pluginDir, entry.name, 'runtime');
      if (hasRuntimeServer(fs, path, runtimeRoot)) return runtimeRoot;
    }
  } catch {
  }

  return colocatedRuntime;
};

const resolveRuntimeCandidate = (fs, path, candidate) => {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const resolved = path.resolve(candidate.trim());
  if (hasRuntimeServer(fs, path, resolved)) return resolved;
  const nestedRuntime = path.join(resolved, 'runtime');
  if (hasRuntimeServer(fs, path, nestedRuntime)) return nestedRuntime;
  return resolved;
};

export const resolveAiCanvasRuntime = (fs, path, os, processLike, body = {}) => {
  const explicitRoot = resolveRuntimeCandidate(fs, path, body.appRoot)
    || resolveRuntimeCandidate(fs, path, body.runtimeRoot)
    || resolveRuntimeCandidate(fs, path, processLike.env.AICANVASPRO_ROOT);
  if (explicitRoot) {
    return {
      runtimeRoot: explicitRoot,
      source: 'explicit',
      pluginPath: null,
    };
  }

  const pluginPath = resolveConfiguredPluginPath(fs, path, os, processLike);
  if (pluginPath) {
    return {
      runtimeRoot: findRuntimeRootNearPlugin(fs, path, pluginPath),
      source: 'opencode-config',
      pluginPath,
    };
  }

  const installedPluginPath = findInstalledPluginPath(fs, path, os, processLike);
  if (installedPluginPath) {
    return {
      runtimeRoot: findRuntimeRootNearPlugin(fs, path, installedPluginPath),
      source: 'opencode-plugins',
      pluginPath: installedPluginPath,
    };
  }

  const pluginsDir = getOpenCodePluginsDir(path, os, processLike);
  return {
    runtimeRoot: pluginsDir
      ? path.join(pluginsDir, 'ai-canvaspro', 'runtime')
      : path.resolve('ai-canvaspro', 'runtime'),
    source: 'default',
    pluginPath: null,
  };
};

const isPortOpen = (net, port, host) => new Promise((resolve) => {
  const socket = net.createConnection({ host, port });
  socket.setTimeout(700);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => resolve(false));
});

const waitForServer = async (net, port, host, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(net, port, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
};

const fetchJson = async (url, timeoutMs = 1500) => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, payload };
};

const fetchText = async (url, timeoutMs = 1500) => {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
  };
};

const isDirectoryListingHtml = (text) => (
  typeof text === 'string'
  && /<title>\s*Directory listing for\s+/i.test(text)
);

const isAiCanvasAppHtml = (text) => (
  typeof text === 'string'
  && (
    text.includes('AI Canvas')
    || text.includes('AI-CanvasPro')
    || text.includes('app-version')
  )
);

const resolveCanvasAppUrl = async (url) => {
  try {
    const root = await fetchText(url);
    if (root.ok && isAiCanvasAppHtml(root.text) && !isDirectoryListingHtml(root.text)) {
      return url;
    }
    if (root.ok && isDirectoryListingHtml(root.text) && root.text.includes('href="runtime/"')) {
      const runtimeUrl = new URL('runtime/', url).toString();
      const runtime = await fetchText(runtimeUrl);
      if (runtime.ok && isAiCanvasAppHtml(runtime.text) && !isDirectoryListingHtml(runtime.text)) {
        return runtimeUrl;
      }
    }
  } catch {
  }
  return url;
};

const getBridgeHealth = async (url) => {
  try {
    const result = await fetchJson(`${url}api/v2/opencode-canvas/health`);
    if (result.ok && result.payload?.ok === true) return result.payload;
  } catch {
  }
  return null;
};

const checkBridgeHealth = async (url) => {
  const health = await getBridgeHealth(url);
  return Boolean(health);
};

export const isInactiveBridgeHealth = (health) => (
  Boolean(health) && health.ok !== true
);

const buildBridgeRuntimeState = (health) => {
  const runtimeRegistered = health?.runtimeRegistered === true;
  return {
    bridgeReady: runtimeRegistered,
    runtimeRegistered,
  };
};

const waitForBridge = async (url, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkBridgeHealth(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
};

const isAiCanvasServer = async (url) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    const serverHeader = response.headers.get('x-aicanvas-server') || '';
    return serverHeader.toLowerCase().includes('ai canvaspro');
  } catch {
    return false;
  }
};

const findWindowsPidOnPort = (spawnSync, port) => {
  if (process.platform !== 'win32' || typeof spawnSync !== 'function') return null;
  const result = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const portPattern = new RegExp(`:${port}\\s+.*\\s+LISTENING\\s+(\\d+)`, 'i');
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(portPattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const stopWindowsPid = async (spawnSync, pid, net, port, host) => {
  if (!pid) return false;
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(net, port, host))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

export const stopAiCanvasService = async ({ spawnSync, net, host, port }) => {
  const normalizedHost = normalizeHost(host);
  const normalizedPort = normalizePort(port);
  const url = `http://${normalizedHost}:${normalizedPort}/`;

  if (!(await isPortOpen(net, normalizedPort, normalizedHost))) {
    return {
      ok: true,
      status: 'not-running',
      url,
    };
  }

  if (!(await isAiCanvasServer(url))) {
    return {
      ok: false,
      status: 'not-aicanvas',
      error: `Port ${normalizedPort} is in use, but it is not an AI-CanvasPro service. Refusing to stop it.`,
      url,
    };
  }

  const pid = findWindowsPidOnPort(spawnSync, normalizedPort);
  if (!pid) {
    return {
      ok: false,
      status: 'pid-not-found',
      error: `AI-CanvasPro is running at ${url}, but OpenChamber could not find its process id on this platform.`,
      url,
    };
  }

  if (!(await stopWindowsPid(spawnSync, pid, net, normalizedPort, normalizedHost))) {
    return {
      ok: false,
      status: 'stop-failed',
      error: `Failed to stop AI-CanvasPro process ${pid} on port ${normalizedPort}.`,
      url,
      pid,
    };
  }

  return {
    ok: true,
    status: 'stopped',
    url,
    pid,
  };
};

const resolvePython = (fs, path, runtimeRoot) => {
  const candidates = process.platform === 'win32'
    ? [
        path.join(runtimeRoot, '.venv', 'Scripts', 'pythonw.exe'),
        path.join(runtimeRoot, 'venv', 'Scripts', 'pythonw.exe'),
        path.join(runtimeRoot, '.venv', 'Scripts', 'python.exe'),
        path.join(runtimeRoot, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(runtimeRoot, '.venv', 'bin', 'python'),
        path.join(runtimeRoot, 'venv', 'bin', 'python'),
      ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
};

const findExecutableOnPath = (fs, path, spawnSync, processLike, commandName) => {
  const envPath = processLike.env?.PATH || processLike.env?.Path || processLike.env?.path || '';
  for (const dir of String(envPath).split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir.trim()) continue;
    const candidate = path.join(dir.trim(), commandName);
    if (fs.existsSync(candidate)) return candidate;
  }

  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const result = spawnSync(finder, [commandName], {
      encoding: 'utf8',
      windowsHide: true,
      env: processLike.env,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') return '';
    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first && fs.existsSync(first) ? first : '';
  } catch {
    return '';
  }
};

const findWingetFfmpegTool = (fs, path, processLike, toolName) => {
  if (process.platform !== 'win32') return '';
  const localAppData = processLike.env?.LOCALAPPDATA || '';
  if (!localAppData) return '';
  const packagesRoot = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(packagesRoot)) return '';

  try {
    const candidates = [];
    for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^Gyan\.FFmpeg_/i.test(entry.name)) continue;
      const packageRoot = path.join(packagesRoot, entry.name);
      for (const versionEntry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
        if (versionEntry.isDirectory()) {
          candidates.push(path.join(packageRoot, versionEntry.name, 'bin', toolName));
        }
      }
      candidates.push(path.join(packageRoot, 'bin', toolName));
    }
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
  }
  return '';
};

export const resolveAiCanvasMediaTools = (fs, path, spawnSync, processLike) => {
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const explicitFfmpeg = processLike.env?.AIC_FFMPEG_EXE;
  const explicitFfprobe = processLike.env?.AIC_FFPROBE_EXE;

  return {
    ffmpeg: explicitFfmpeg && fs.existsSync(explicitFfmpeg)
      ? explicitFfmpeg
      : findExecutableOnPath(fs, path, spawnSync, processLike, ffmpegName)
        || findWingetFfmpegTool(fs, path, processLike, ffmpegName)
        || 'ffmpeg',
    ffprobe: explicitFfprobe && fs.existsSync(explicitFfprobe)
      ? explicitFfprobe
      : findExecutableOnPath(fs, path, spawnSync, processLike, ffprobeName)
        || findWingetFfmpegTool(fs, path, processLike, ffprobeName)
        || 'ffprobe',
  };
};

export const registerAiCanvasRoutes = (app, dependencies) => {
  const { fs, path, spawn, spawnSync, net, os, processLike = process } = dependencies;

  app.post('/api/aicanvas/start', async (req, res) => {
    const host = normalizeHost(req.body?.host ?? processLike.env.AICANVASPRO_HOST);
    const port = normalizePort(req.body?.port ?? processLike.env.AICANVASPRO_PORT);
    const runtimeResolution = resolveAiCanvasRuntime(fs, path, os, processLike, req.body || {});
    const runtimeRoot = runtimeResolution.runtimeRoot;
    const serverPath = path.join(runtimeRoot, 'server.py');
    const url = `http://${host}:${port}/`;

    try {
      if (!fs.existsSync(serverPath)) {
        return res.status(404).json({
          ok: false,
          error: `AI-CanvasPro runtime server.py not found: ${serverPath}. Clone the plugin under ~/.config/opencode/plugins and configure ./plugins/<plugin-folder>/ai-canvaspro.js in opencode.json.`,
          runtimeRoot,
          pluginPath: runtimeResolution.pluginPath,
          source: runtimeResolution.source,
        });
      }

      if (await isPortOpen(net, port, host)) {
        const bridgeHealth = await getBridgeHealth(url);
        if (bridgeHealth) {
          const appUrl = await resolveCanvasAppUrl(url);
          return res.json({
            ok: true,
            status: 'already-running',
            url: appUrl,
            serviceUrl: url,
            runtimeRoot,
            pluginPath: runtimeResolution.pluginPath,
            source: runtimeResolution.source,
            openedInBuiltinBrowser: true,
            canvasSession: true,
            ...buildBridgeRuntimeState(bridgeHealth),
          });
        }

        if (await isAiCanvasServer(url)) {
          const pid = findWindowsPidOnPort(spawnSync, port);
          if (pid && await stopWindowsPid(spawnSync, pid, net, port, host)) {
            console.warn(`[aicanvas] Restarted stale AI-CanvasPro server on ${host}:${port}`);
          } else {
            return res.status(409).json({
              ok: false,
              staleServer: true,
              error: `AI-CanvasPro is already running at ${url}, but it does not expose the OpenCode bridge. Stop that old process and run /aicanvas again.`,
              runtimeRoot,
              pluginPath: runtimeResolution.pluginPath,
              source: runtimeResolution.source,
            });
          }
        } else {
          return res.status(409).json({
            ok: false,
            staleServer: true,
            error: `Port ${port} is already in use, but the OpenCode canvas bridge is not available there.`,
            runtimeRoot,
            pluginPath: runtimeResolution.pluginPath,
            source: runtimeResolution.source,
          });
        }
      }

      const python = resolvePython(fs, path, runtimeRoot);
      const mediaTools = resolveAiCanvasMediaTools(fs, path, spawnSync, processLike);
      const child = spawn(python, ['server.py', String(port), host], {
        cwd: runtimeRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...processLike.env,
          AICANVAS_PORT: String(port),
          AICANVAS_HOST: host,
          AIC_FFMPEG_EXE: mediaTools.ffmpeg,
          AIC_FFPROBE_EXE: mediaTools.ffprobe,
        },
      });
      child.unref();

      const ready = await waitForServer(net, port, host);
      if (!ready) {
        return res.status(504).json({
          ok: false,
          error: `AI-CanvasPro did not become ready at ${url}. Run the plugin install script first if runtime dependencies are missing.`,
          runtimeRoot,
          pluginPath: runtimeResolution.pluginPath,
          source: runtimeResolution.source,
        });
      }

      if (!(await waitForBridge(url))) {
        return res.status(504).json({
          ok: false,
          error: `AI-CanvasPro started at ${url}, but the OpenCode canvas bridge did not become ready.`,
          runtimeRoot,
          pluginPath: runtimeResolution.pluginPath,
          source: runtimeResolution.source,
        });
      }

      const bridgeHealth = await getBridgeHealth(url);
      return res.json({
        ok: true,
        status: 'started',
        url: await resolveCanvasAppUrl(url),
        serviceUrl: url,
        runtimeRoot,
        pluginPath: runtimeResolution.pluginPath,
        source: runtimeResolution.source,
        openedInBuiltinBrowser: true,
        canvasSession: true,
        ...buildBridgeRuntimeState(bridgeHealth),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to start AI-CanvasPro',
        runtimeRoot,
        pluginPath: runtimeResolution.pluginPath,
        source: runtimeResolution.source,
      });
    }
  });

  app.post('/api/aicanvas/stop', async (req, res) => {
    const host = normalizeHost(req.body?.host ?? processLike.env.AICANVASPRO_HOST);
    const port = normalizePort(req.body?.port ?? processLike.env.AICANVASPRO_PORT);
    const url = `http://${host}:${port}/`;

    try {
      const result = await stopAiCanvasService({ spawnSync, net, host, port });
      if (result.ok) return res.json(result);
      if (result.status === 'not-aicanvas') return res.status(409).json(result);
      if (result.status === 'pid-not-found') return res.status(501).json(result);
      return res.status(500).json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to stop AI-CanvasPro',
        url,
      });
    }
  });
};
