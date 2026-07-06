import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { isInactiveBridgeHealth, resolveAiCanvasAllowedOrigins, resolveAiCanvasBrowserUrl, resolveAiCanvasConnectHost, resolveAiCanvasMediaTools, resolveAiCanvasRuntime } from './routes.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAiCanvasRuntime', () => {
  test('finds a versioned runtime next to a standalone configured plugin file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-aicanvas-'));
    const configDir = path.join(root, '.config', 'opencode');
    const pluginsDir = path.join(configDir, 'plugins');
    const runtimeRoot = path.join(pluginsDir, 'AI-CanvasPro-0.5.0', 'runtime');

    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, 'server.py'), '', 'utf8');
    fs.writeFileSync(path.join(pluginsDir, 'ai-canvaspro.js'), 'export default {}', 'utf8');
    fs.writeFileSync(
      path.join(configDir, 'opencode.json'),
      JSON.stringify({ plugin: ['./plugins/ai-canvaspro.js'] }),
      'utf8',
    );

    const fakeOs = {
      homedir: () => root,
    };

    const result = resolveAiCanvasRuntime(fs, path, fakeOs, {
      env: {
        USERPROFILE: root,
      },
    });

    expect(result).toEqual({
      runtimeRoot,
      source: 'opencode-config',
      pluginPath: path.join(pluginsDir, 'ai-canvaspro.js'),
    });
  });
});

describe('isInactiveBridgeHealth', () => {
  test('keeps a healthy bridge reusable while the browser runtime reconnects', () => {
    expect(isInactiveBridgeHealth({ ok: true, runtimeRegistered: false })).toBe(false);
    expect(isInactiveBridgeHealth({ ok: true })).toBe(false);
    expect(isInactiveBridgeHealth({ ok: true, runtimeRegistered: true })).toBe(false);
    expect(isInactiveBridgeHealth({ ok: false, runtimeRegistered: true })).toBe(true);
  });
});

describe('resolveAiCanvasBrowserUrl', () => {
  test('maps an internally resolved app path onto the configured public URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => (url.endsWith('/runtime/')
          ? '<html><body>AI-CanvasPro</body></html>'
          : '<html><title>Directory listing for /</title><a href="runtime/">runtime/</a></html>'),
      };
    });

    await expect(resolveAiCanvasBrowserUrl('http://127.0.0.1:8777/', {
      env: {
        AICANVASPRO_PUBLIC_URL: 'https://canvas.kklay.com',
      },
    })).resolves.toBe('https://canvas.kklay.com/runtime/');
  });
});

describe('resolveAiCanvasConnectHost', () => {
  test('uses loopback for server-side checks when Canvas binds all interfaces', () => {
    expect(resolveAiCanvasConnectHost('0.0.0.0')).toBe('127.0.0.1');
    expect(resolveAiCanvasConnectHost('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('resolveAiCanvasAllowedOrigins', () => {
  test('adds the public Canvas URL origin for browser runtime registration', () => {
    expect(resolveAiCanvasAllowedOrigins({
      env: {
        AIC_ALLOWED_ORIGINS: 'https://existing.example',
        AICANVASPRO_PUBLIC_URL: 'https://canvas.kklay.com/runtime/',
      },
    })).toBe('https://existing.example,https://canvas.kklay.com,null');
  });

  test('preserves an explicitly configured sandbox iframe null origin', () => {
    expect(resolveAiCanvasAllowedOrigins({
      env: {
        AIC_ALLOWED_ORIGINS: 'https://existing.example,null',
        AICANVASPRO_PUBLIC_URL: 'https://canvas.kklay.com/runtime/',
      },
    })).toBe('https://existing.example,null,https://canvas.kklay.com');
  });
});

describe('resolveAiCanvasMediaTools', () => {
  test('uses ffmpeg and ffprobe from the process PATH', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-aicanvas-tools-'));
    const binDir = path.join(root, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const ffmpegPath = path.join(binDir, ffmpegName);
    const ffprobePath = path.join(binDir, ffprobeName);
    fs.writeFileSync(ffmpegPath, '', 'utf8');
    fs.writeFileSync(ffprobePath, '', 'utf8');

    const result = resolveAiCanvasMediaTools(fs, path, () => ({ status: 1, stdout: '' }), {
      env: {
        PATH: binDir,
      },
    });

    expect(result).toEqual({
      ffmpeg: ffmpegPath,
      ffprobe: ffprobePath,
    });
  });
});
