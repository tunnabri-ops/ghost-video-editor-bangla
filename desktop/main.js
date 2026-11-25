'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ffmpeg-static ships the ffmpeg binary with the app (runtime dependency,
// not devDependency). If it cannot be resolved, every video op fails
// gracefully with { ok: false, error: 'ffmpeg-missing' } — never a crash.
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
} catch (_err) {
  ffmpegPath = null;
}

const REPO = 'tunnabri-ops/ghost-video-editor-bangla';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'flv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma'];

// v1.1.0 — export presets: name -> [width, height] (null = original size).
const EXPORT_PRESETS = {
  original: null,
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  vertical: [1080, 1920], // 9:16 — Shorts / Reels
};

function presetFilter(preset) {
  // Scale to fit inside the target, pad the rest with black — never crops.
  const target = EXPORT_PRESETS[preset];
  if (!target) return null;
  const [w, h] = target;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

function escapeSubtitlesPath(filePath) {
  // ffmpeg subtitles filter: forward slashes, escape ':' and '\''.
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

function subtitlesFilter(srtPath, fontSize) {
  const size = Math.max(12, Math.min(200, Number(fontSize) || 40));
  return `subtitles='${escapeSubtitlesPath(srtPath)}':force_style='Fontsize=${size}'`;
}

async function probeHasAudio(filePath) {
  const result = await runFfmpeg(['-hide_banner', '-i', filePath]);
  return /Stream #\d+:\d+[^:]*: Audio:/.test(result.stderr);
}

// 32x32 white ghost on transparent background (embedded, no download).
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAvElEQVR4nO2XwQ2DMAxFE9QJuHUD9p+GDXpjhfSCqsiKjf+vQ4vIO2E5tj/BJkpKdyczQaWUoibMGcoJLbYKs0KmHsWR9S4BaHEk7lAAW9wbbwr4trgnj7sHeqEKiHr7o3z/uwNn8UAD5ufyed5eq9unAe1AXUDali9MQA+GAEiAbKzatnwW6pEZ/SNKqX1Ew2NYw4ydhO4BduzCBERBC2CbTvLzJrzuJxgCugvQLhZ5h/FBAlpBtc36BpI31ItTQaFzSPkAAAAASUVORK5CYII=';

let mainWindow = null;
let tray = null;
let isQuitting = false;

function trayIcon() {
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate() {
  const currentVersion = app.getVersion();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(LATEST_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ghost-video-editor-bangla' },
    });
    clearTimeout(timer);
    if (!res.ok) return { updateAvailable: false, version: null, url: null, currentVersion };
    const data = await res.json();
    const tag = String(data.tag_name || '').replace(/^v/, '');
    const url = data.html_url || RELEASES_URL;
    if (!tag) return { updateAvailable: false, version: null, url: null, currentVersion };
    return {
      updateAvailable: compareVersions(tag, currentVersion) > 0,
      version: tag,
      url,
      currentVersion,
    };
  } catch (_err) {
    // Silent on failure: offline / GitHub unreachable is not an error for the user.
    return { updateAvailable: false, version: null, url: null, currentVersion };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    backgroundColor: '#0f172a',
    title: 'Ghost Video Editor Bangla',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Close hides to tray instead of quitting (Quit comes from the tray menu).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Ghost Video Editor Bangla');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / দেখান',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Check for update / আপডেট দেখুন',
      click: async () => {
        const result = await checkForUpdate();
        if (mainWindow) mainWindow.webContents.send('update-available', result);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit / বন্ধ করুন',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray on Windows/Linux; quit on macOS like a normal app.
  if (process.platform === 'darwin') app.quit();
});

// ---- ffmpeg helpers -------------------------------------------------------

function ffmpegAvailable() {
  return typeof ffmpegPath === 'string' && ffmpegPath.length > 0 && fs.existsSync(ffmpegPath);
}

function parseTimeToSeconds(text) {
  // "HH:MM:SS.xx" from ffmpeg's time= output.
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(text || ''));
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseDurationFromFfmpegOutput(stderr) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseVideoStream(stderr) {
  // e.g. "Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps"
  const m = /Stream #\d+:\d+[^:]*: Video:\s*([^,]+).*?(\d+)x(\d+)[^,]*,\s*([\d.]+)\s*fps/.exec(stderr);
  if (m) return { codec: m[1].trim(), width: Number(m[2]), height: Number(m[3]), fps: Number(m[4]) };
  const m2 = /Stream #\d+:\d+[^:]*: Video:\s*([^,]+).*?(\d+)x(\d+)/.exec(stderr);
  if (m2) return { codec: m2[1].trim(), width: Number(m2[2]), height: Number(m2[3]), fps: null };
  return { codec: null, width: null, height: null, fps: null };
}

// Run ffmpeg once, collecting stderr. onProgress(stderrChunk) is called with
// each chunk so callers can parse time= and emit progress events.
function runFfmpeg(args, onProgress) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable()) {
      resolve({ ok: false, code: null, stderr: '', error: 'ffmpeg-missing' });
      return;
    }
    let stderr = '';
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onProgress) onProgress(text);
    });
    child.on('error', (err) => {
      resolve({ ok: false, code: null, stderr, error: String(err && err.message ? err.message : err) });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stderr, error: code === 0 ? null : `ffmpeg-exit-${code}` });
    });
  });
}

async function probeDuration(filePath) {
  const result = await runFfmpeg(['-hide_banner', '-i', filePath]);
  return parseDurationFromFfmpegOutput(result.stderr);
}

function withProgress(totalSeconds, event) {
  return (chunk) => {
    if (!totalSeconds || !event || !mainWindow) return;
    const m = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(chunk);
    if (!m) return;
    const done = parseTimeToSeconds(m[1]);
    if (done === null) return;
    const percent = Math.max(0, Math.min(100, Math.round((done / totalSeconds) * 100)));
    mainWindow.webContents.send('export-progress', { percent, seconds: done, totalSeconds });
  };
}

function suffixName(filePath, suffix) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(path.dirname(filePath), `${base}${suffix}${ext || '.mp4'}`);
}

async function askOutputPath(event, defaultName) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (canceled || !filePath) return null;
  return filePath.endsWith('.mp4') ? filePath : `${filePath}.mp4`;
}

// ---- drawtext font --------------------------------------------------------
// drawtext needs a real font file. Look for a bundled font first, then the
// usual system locations. If none exists, text overlay fails gracefully
// with 'font-missing' instead of crashing ffmpeg.
function findFontFile() {
  const candidates = [
    path.join(__dirname, 'assets', 'DejaVuSans.ttf'),
    path.join(__dirname, 'assets', 'NotoSansBengali-Regular.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_err) { /* try next */ }
  }
  return null;
}

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function textPosition(position, fontsize) {
  // x:y expressions for drawtext. fontsize is used for the top/bottom margins.
  switch (position) {
    case 'top-left': return { x: '20', y: '20' };
    case 'top-center': return { x: '(w-text_w)/2', y: '20' };
    case 'top-right': return { x: 'w-text_w-20', y: '20' };
    case 'center': return { x: '(w-text_w)/2', y: '(h-text_h)/2' };
    case 'bottom-left': return { x: '20', y: `h-text_h-20` };
    case 'bottom-right': return { x: 'w-text_w-20', y: `h-text_h-20` };
    case 'bottom-center':
    default: return { x: '(w-text_w)/2', y: `h-text_h-20` };
  }
}

// Build the video filter chain shared by export-video / apply-filter /
// add-text / change-speed. Returns { filter, error }.
function buildVideoFilter(options) {
  const filters = [];
  const speed = Number(options.speed) || 1;
  if (speed !== 1) {
    if (speed <= 0 || speed > 4) return { filter: null, error: 'invalid-speed' };
    filters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
  }
  const brightness = Number(options.brightness) || 0; // -100..100 -> -1..1
  const contrast = options.contrast === undefined ? 100 : Number(options.contrast); // 0..200 -> 0..2
  if (brightness !== 0 || contrast !== 100) {
    const b = Math.max(-1, Math.min(1, brightness / 100)).toFixed(2);
    const c = Math.max(0, Math.min(2, contrast / 100)).toFixed(2);
    filters.push(`eq=brightness=${b}:contrast=${c}`);
  }
  if (options.text) {
    const fontFile = findFontFile();
    if (!fontFile) return { filter: null, error: 'font-missing' };
    const size = Math.max(12, Math.min(200, Number(options.textSize) || 48));
    const pos = textPosition(options.textPosition || 'bottom-center', size);
    const fontFileEscaped = fontFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    filters.push(
      `drawtext=fontfile='${fontFileEscaped}':text='${escapeDrawtext(options.text)}'` +
      `:fontsize=${size}:fontcolor=white:borderw=2:bordercolor=black@0.6` +
      `:x=${pos.x}:y=${pos.y}`
    );
  }
  return { filter: filters.length ? filters.join(',') : null, error: null };
}

function audioFilterForSpeed(speed) {
  // atempo only supports 0.5–2.0 per filter; chain it for other speeds.
  if (!speed || speed === 1) return null;
  const parts = [];
  let remaining = speed;
  while (remaining > 2.0) { parts.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining /= 0.5; }
  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(',');
}

// ---- IPC: pick video(s) ---------------------------------------------------
ipcMain.handle('pick-video', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Video files', extensions: VIDEO_EXTENSIONS }],
  });
  if (canceled || !filePaths.length) return { cancelled: true, path: null };
  return { cancelled: false, path: filePaths[0] };
});

ipcMain.handle('pick-videos', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video files', extensions: VIDEO_EXTENSIONS }],
  });
  if (canceled || !filePaths.length) return { cancelled: true, paths: [] };
  return { cancelled: false, paths: filePaths };
});

// ---- IPC: pick subtitle / music files (v1.1.0) ---------------------------
ipcMain.handle('pick-subtitle', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'SRT subtitles', extensions: ['srt'] }],
  });
  if (canceled || !filePaths.length) return { cancelled: true, path: null };
  return { cancelled: false, path: filePaths[0] };
});

ipcMain.handle('pick-music', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }],
  });
  if (canceled || !filePaths.length) return { cancelled: true, path: null };
  return { cancelled: false, path: filePaths[0] };
});

// Read an SRT file as text (renderer parses the cues for the preview).
ipcMain.handle('read-subtitle-file', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    return { ok: false, error: 'file-not-found' };
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// ---- IPC: video info ------------------------------------------------------
// ffprobe is NOT shipped with ffmpeg-static, so info comes from
// `ffmpeg -i <file>` (stderr) — duration + video stream. Honest and enough.
ipcMain.handle('get-video-info', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    return { ok: false, error: 'file-not-found' };
  }
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const result = await runFfmpeg(['-hide_banner', '-i', filePath]);
  const duration = parseDurationFromFfmpegOutput(result.stderr);
  const video = parseVideoStream(result.stderr);
  const audio = /Stream #\d+:\d+[^:]*: Audio:/.test(result.stderr);
  return {
    ok: true,
    path: filePath,
    name: path.basename(filePath),
    size: fs.statSync(filePath).size,
    duration,
    ...video,
    hasAudio: audio,
  };
});

// ---- IPC: save dialog -----------------------------------------------------
ipcMain.handle('save-dialog', async (_event, defaultName) => {
  const filePath = await askOutputPath(null, defaultName || 'ghost-video-edited.mp4');
  if (!filePath) return { cancelled: true, path: null };
  return { cancelled: false, path: filePath };
});

// ---- IPC: trim ------------------------------------------------------------
ipcMain.handle('trim-video', async (_event, payload) => {
  const { input, start, end, output } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const s = Number(start) || 0;
  const e = Number(end);
  if (e !== undefined && !Number.isNaN(e) && e <= s) return { ok: false, error: 'invalid-range' };
  const outPath = output || (await askOutputPath(null, suffixName(input, '-trimmed')));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const total = (Number.isNaN(e) ? await probeDuration(input) : e - s) || null;
  const args = ['-hide_banner', '-y', '-ss', String(s)];
  if (!Number.isNaN(e)) args.push('-to', String(e));
  args.push('-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', outPath);
  const result = await runFfmpeg(args, withProgress(total, _event));
  if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
  return { ok: true, path: outPath };
});

// ---- IPC: split -----------------------------------------------------------
ipcMain.handle('split-video', async (_event, payload) => {
  const { input, at, output, output2 } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const t = Number(at);
  if (!t || t <= 0) return { ok: false, error: 'invalid-split-point' };
  let out1 = output;
  let out2 = output2;
  if (!out1) {
    out1 = await askOutputPath(null, suffixName(input, '-part1'));
    if (!out1) return { ok: false, cancelled: true, error: null };
  }
  if (!out2) out2 = suffixName(out1.replace('-part1', ''), '-part2');
  const duration = await probeDuration(input);
  if (duration && t >= duration) return { ok: false, error: 'split-after-end' };
  const args1 = ['-hide_banner', '-y', '-ss', '0', '-to', String(t), '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', out1];
  const r1 = await runFfmpeg(args1, withProgress(t, _event));
  if (!r1.ok) return { ok: false, error: r1.error, detail: r1.stderr.slice(-500) };
  const args2 = ['-hide_banner', '-y', '-ss', String(t), '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', out2];
  const r2 = await runFfmpeg(args2, withProgress(duration ? duration - t : null, _event));
  if (!r2.ok) return { ok: false, error: r2.error, detail: r2.stderr.slice(-500), path: out1 };
  return { ok: true, path: out1, path2: out2 };
});

// ---- IPC: merge -----------------------------------------------------------
// Default: concat demuxer with -c copy (fast, no re-encode). Works when all
// clips share codec/container; mismatched clips fail honestly.
// v1.1.0: with transition ("fade"/"slide") the clips are normalised and
// joined with ffmpeg's xfade (+ acrossfade for audio). With a preset the
// output is re-encoded at that resolution instead of copied.
ipcMain.handle('merge-videos', async (_event, payload) => {
  const { inputs, output, transition, transitionDuration, preset } = payload || {};
  if (!Array.isArray(inputs) || inputs.length < 2) return { ok: false, error: 'need-two-clips' };
  if (inputs.some((p) => !fs.existsSync(p))) return { ok: false, error: 'file-not-found' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const trans = transition || 'none';
  if (!['none', 'fade', 'slide'].includes(trans)) return { ok: false, error: 'invalid-transition' };
  const tDur = trans === 'none' ? 0 : Math.max(0.05, Math.min(2, Number(transitionDuration) || 0.5));
  const pFilter = preset && preset !== 'original' ? presetFilter(preset) : null;
  if (preset && preset !== 'original' && !pFilter) return { ok: false, error: 'invalid-preset' };
  const outPath = output || (await askOutputPath(null, 'ghost-video-merged.mp4'));
  if (!outPath) return { ok: false, cancelled: true, error: null };

  if (trans === 'none' && !pFilter) {
    const listPath = path.join(os.tmpdir(), `gve-merge-${Date.now()}.txt`);
    const listContent = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent, 'utf8');
    try {
      const total = (await Promise.all(inputs.map((p) => probeDuration(p))))
        .reduce((sum, d) => sum + (d || 0), 0);
      const result = await runFfmpeg(
        ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath],
        withProgress(total || null, _event)
      );
      if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
      return { ok: true, path: outPath };
    } finally {
      try { fs.unlinkSync(listPath); } catch (_err) { /* temp file cleanup */ }
    }
  }

  // Re-encode path: normalise to the first clip's size/fps, then join.
  const infos = await Promise.all(inputs.map(async (p) => {
    const r = await runFfmpeg(['-hide_banner', '-i', p]);
    return { duration: parseDurationFromFfmpegOutput(r.stderr), video: parseVideoStream(r.stderr), hasAudio: /Stream #\d+:\d+[^:]*: Audio:/.test(r.stderr) };
  }));
  const first = infos[0];
  if (!first.video.width) return { ok: false, error: 'file-not-found' };
  let width = first.video.width - (first.video.width % 2);
  let height = first.video.height - (first.video.height % 2);
  const fps = first.video.fps || 25;
  if (trans !== 'none') {
    for (const info of infos) {
      if (!info.duration || info.duration <= tDur) return { ok: false, error: 'clip-too-short' };
    }
  }
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gve-merge-'));
  try {
    const normed = [];
    for (let i = 0; i < inputs.length; i++) {
      const tmp = path.join(tmpdir, `part${i}.mp4`);
      const r = await runFfmpeg(
        ['-hide_banner', '-y', '-i', inputs[i],
         '-vf', `scale=${width}:${height},fps=${fps},format=yuv420p`,
         '-c:v', 'libx264', '-c:a', 'aac', '-video_track_timescale', '90000', tmp]
      );
      if (!r.ok) return { ok: false, error: r.error, detail: r.stderr.slice(-500) };
      normed.push(tmp);
    }
    const total = infos.reduce((sum, d) => sum + (d.duration || 0), 0);
    if (trans === 'none') {
      // Preset only: concat demuxer + re-encode at the preset size.
      const listPath = path.join(tmpdir, 'concat.txt');
      fs.writeFileSync(listPath, normed.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
      const result = await runFfmpeg(
        ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
         '-vf', pFilter, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-movflags', '+faststart', outPath],
        withProgress(total || null, _event)
      );
      if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
      return { ok: true, path: outPath };
    }
    // xfade path.
    const xfadeType = trans === 'fade' ? 'fade' : 'slideleft';
    const args = [];
    normed.forEach((p) => args.push('-i', p));
    let chain = '';
    let offset = infos[0].duration - tDur;
    chain += `[0:v][1:v]xfade=transition=${xfadeType}:duration=${tDur.toFixed(3)}:offset=${offset.toFixed(3)}[x0];`;
    for (let i = 2; i < normed.length; i++) {
      offset = infos.slice(0, i).reduce((s, d) => s + (d.duration || 0), 0) - i * tDur;
      chain += `[x${i - 2}][${i}:v]xfade=transition=${xfadeType}:duration=${tDur.toFixed(3)}:offset=${offset.toFixed(3)}[x${i - 1}];`;
    }
    const lastV = `[x${normed.length - 2}]`;
    const allAudio = infos.every((d) => d.hasAudio);
    let mapV = lastV;
    if (pFilter) {
      chain += `${lastV}${pFilter}[vout];`;
      mapV = '[vout]';
    }
    if (allAudio) {
      chain += '[0:a][1:a]acrossfade=d=' + tDur.toFixed(3) + '[a0];';
      for (let i = 2; i < normed.length; i++) {
        chain += `[a${i - 2}][${i}:a]acrossfade=d=${tDur.toFixed(3)}[a${i - 1}];`;
      }
      const lastA = `[a${normed.length - 2}]`;
      chain = chain.replace(/;$/, '');
      args.push('-filter_complex', chain, '-map', mapV, '-map', lastA);
    } else {
      chain = chain.replace(/;$/, '');
      args.push('-filter_complex', chain, '-map', mapV, '-an');
    }
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-movflags', '+faststart', outPath);
    const result = await runFfmpeg(args, withProgress(total - (normed.length - 1) * tDur || null, _event));
    if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
    return { ok: true, path: outPath };
  } finally {
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (_err) { /* cleanup */ }
  }
});

// ---- IPC: text overlay ----------------------------------------------------
ipcMain.handle('add-text', async (_event, payload) => {
  const { input, text, textPosition: position, textSize, output } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!text) return { ok: false, error: 'empty-text' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const built = buildVideoFilter({ text, textPosition: position, textSize });
  if (built.error) return { ok: false, error: built.error };
  const outPath = output || (await askOutputPath(null, suffixName(input, '-text')));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const duration = await probeDuration(input);
  const result = await runFfmpeg(
    ['-hide_banner', '-y', '-i', input, '-vf', built.filter, '-c:a', 'copy', outPath],
    withProgress(duration, _event)
  );
  if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
  return { ok: true, path: outPath };
});

// ---- IPC: subtitles (v1.1.0) --------------------------------------------
// Burns an SRT file into the video with ffmpeg's subtitles filter
// (libass shapes Bangla correctly). Audio is copied untouched.
ipcMain.handle('add-subtitles', async (_event, payload) => {
  const { input, subtitlePath, fontSize, output } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!subtitlePath || !fs.existsSync(subtitlePath)) return { ok: false, error: 'subtitle-missing' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const outPath = output || (await askOutputPath(null, suffixName(input, '-subtitles')));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const duration = await probeDuration(input);
  const result = await runFfmpeg(
    ['-hide_banner', '-y', '-i', input, '-vf', subtitlesFilter(subtitlePath, fontSize),
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
     '-movflags', '+faststart', outPath],
    withProgress(duration, _event)
  );
  if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
  return { ok: true, path: outPath };
});

// ---- IPC: background music (v1.1.0) ---------------------------------------
// Mixes a music file under the clip's own audio (looped to the video
// length, faded in/out). If the video has no audio, the music is the audio.
ipcMain.handle('add-music', async (_event, payload) => {
  const { input, musicPath, musicVolume, fadeIn, fadeOut, output } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!musicPath || !fs.existsSync(musicPath)) return { ok: false, error: 'music-missing' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const vol = Number(musicVolume);
  if (Number.isNaN(vol) || vol < 0 || vol > 1) return { ok: false, error: 'invalid-volume' };
  const fi = Math.max(0, Number(fadeIn) || 0);
  const fo = Math.max(0, Number(fadeOut) || 0);
  const outPath = output || (await askOutputPath(null, suffixName(input, '-music')));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const duration = await probeDuration(input);
  const hasAudio = await probeHasAudio(input);
  const fadeOutStart = Math.max(0, (duration || 0) - fo);
  const musicFilter = `afade=t=in:st=0:d=${fi.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fo.toFixed(3)},volume=${vol.toFixed(3)}`;
  const args = ['-hide_banner', '-y', '-i', input, '-stream_loop', '-1', '-i', musicPath];
  if (hasAudio) {
    args.push('-filter_complex',
      `[0:a]volume=1.0[a0];[1:a]${musicFilter}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]`,
      '-map', '0:v', '-map', '[a]');
  } else {
    args.push('-filter_complex', `[1:a]${musicFilter}[a]`, '-map', '0:v', '-map', '[a]');
  }
  args.push('-t', String(duration), '-c:v', 'copy', '-c:a', 'aac',
    '-movflags', '+faststart', outPath);
  const result = await runFfmpeg(args, withProgress(duration, _event));
  if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
  return { ok: true, path: outPath };
});

// ---- IPC: brightness / contrast filter ------------------------------------
ipcMain.handle('apply-filter', async (_event, payload) => {
  const { input, brightness, contrast, output } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const built = buildVideoFilter({ brightness, contrast });
  if (built.error) return { ok: false, error: built.error };
  if (!built.filter) return { ok: false, error: 'no-filter' };
  const outPath = output || (await askOutputPath(null, suffixName(input, '-filtered')));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const duration = await probeDuration(input);
  const result = await runFfmpeg(
    ['-hide_banner', '-y', '-i', input, '-vf', built.filter, '-c:a', 'copy', outPath],
    withProgress(duration, _event)
  );
  if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
  return { ok: true, path: outPath };
});

// ---- IPC: speed change ----------------------------------------------------
ipcMain.handle('change-speed', async (_event, payload) => {
  const { input, speed, mute, output } = payload || {};
  if (!input || !fs.existsSync(input)) return { ok: false, error: 'file-not-found' };
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-missing' };
  const s = Number(speed);
  if (!s || s <= 0 || s > 4) return { ok: false, error: 'invalid-speed' };
  const built = buildVideoFilter({ speed: s });
  if (built.error) return { ok: false, error: built.error };
  const outPath = output || (await askOutputPath(null, suffixName(input, `-${s}x`)));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const duration = await probeDuration(input);
  const args = ['-hide_banner', '-y', '-i', input, '-vf', built.filter];
  if (mute) {
    args.push('-an');
  } else {
    const af = audioFilterForSpeed(s);
    if (af) args.push('-af', af);
  }
  args.push(outPath);
  const result = await runFfmpeg(args, withProgress(duration ? duration / s : null, _event));
  if (!result.ok) return { ok: false, error: result.error, detail: result.stderr.slice(-500) };
  return { ok: true, path: outPath };
});

// ---- IPC: full export (all current settings, one pass) --------------------
// payload: { input, start, end, speed, brightness, contrast, text,
//            textPosition, textSize, mute, output,
//            subtitlePath, subtitleFontSize,            // v1.1.0
//            musicPath, musicVolume, fadeIn, fadeOut,   // v1.1.0
//            preset }                                    // v1.1.0
// Emits export-progress while running, then export-done / export-error.
ipcMain.handle('export-video', async (event, payload) => {
  const { input, start, end, speed, brightness, contrast, text, textPosition: position, textSize, mute, output,
    subtitlePath, subtitleFontSize, musicPath, musicVolume, fadeIn, fadeOut, preset } = payload || {};
  if (!input || !fs.existsSync(input)) {
    const err = { error: 'file-not-found' };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  if (!ffmpegAvailable()) {
    const err = { error: 'ffmpeg-missing' };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  if (subtitlePath && !fs.existsSync(subtitlePath)) {
    const err = { error: 'subtitle-missing' };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  if (musicPath && !fs.existsSync(musicPath)) {
    const err = { error: 'music-missing' };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  const s = Number(start) || 0;
  const e = Number(end);
  if (!Number.isNaN(e) && e <= s) {
    const err = { error: 'invalid-range' };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  const built = buildVideoFilter({ speed, brightness, contrast, text, textPosition: position, textSize });
  if (built.error) {
    const err = { error: built.error };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  // v1.1.0: append subtitles burn + preset scale/pad to the video chain.
  const vfParts = [];
  if (built.filter) vfParts.push(built.filter);
  if (subtitlePath) vfParts.push(subtitlesFilter(subtitlePath, subtitleFontSize));
  const pFilter = preset && preset !== 'original' ? presetFilter(preset) : null;
  if (preset && preset !== 'original' && !pFilter) {
    const err = { error: 'invalid-preset' };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  if (pFilter) vfParts.push(pFilter);
  const videoFilter = vfParts.length ? vfParts.join(',') : null;

  const outPath = output || (await askOutputPath(event, suffixName(input, '-edited')));
  if (!outPath) return { ok: false, cancelled: true, error: null };
  const duration = await probeDuration(input);
  const total = Number.isNaN(e) ? duration : e - s;
  const spd = Number(speed) || 1;
  const hasMusic = !!musicPath && !mute;
  const args = ['-hide_banner', '-y', '-ss', String(s)];
  if (!Number.isNaN(e)) args.push('-to', String(e));
  args.push('-i', input);
  if (hasMusic) args.push('-stream_loop', '-1', '-i', musicPath);

  let result;
  if (hasMusic) {
    // Music needs a filter_complex: video chain + audio mix.
    const vol = Math.max(0, Math.min(1, Number(musicVolume) || 0.5));
    const fi = Math.max(0, Number(fadeIn) || 0);
    const fo = Math.max(0, Number(fadeOut) || 0);
    const outDuration = total || duration || 0;
    const fadeOutStart = Math.max(0, outDuration - fo);
    const musicFilter = `afade=t=in:st=0:d=${fi.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fo.toFixed(3)},volume=${vol.toFixed(3)}`;
    const hasAudio = await probeHasAudio(input);
    const audioChain = [];
    if (spd !== 1) {
      const af = audioFilterForSpeed(spd);
      if (af) audioChain.push(`[0:a]${af}[a0]`);
      else audioChain.push('[0:a]anull[a0]');
    } else {
      audioChain.push('[0:a]anull[a0]');
    }
    const parts = [];
    if (videoFilter) parts.push(`[0:v]${videoFilter}[v]`);
    if (hasAudio) {
      parts.push(audioChain[0]);
      parts.push(`[1:a]${musicFilter}[a1]`);
      parts.push('[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]');
    } else {
      parts.push(`[1:a]${musicFilter}[a]`);
    }
    args.push('-filter_complex', parts.join(';'));
    args.push('-map', videoFilter ? '[v]' : '0:v', '-map', '[a]');
  } else {
    if (videoFilter) args.push('-vf', videoFilter);
    if (mute) {
      args.push('-an');
    } else if (spd !== 1) {
      const af = audioFilterForSpeed(spd);
      if (af) args.push('-af', af);
    }
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', outPath);
  result = await runFfmpeg(args, withProgress(total, event));
  if (!result.ok) {
    const err = { error: result.error, detail: result.stderr.slice(-500) };
    if (mainWindow) mainWindow.webContents.send('export-error', err);
    return { ok: false, ...err };
  }
  if (mainWindow) mainWindow.webContents.send('export-done', { path: outPath });
  return { ok: true, path: outPath };
});

// ---- IPC: update check ----------------------------------------------------
ipcMain.handle('check-for-update', async () => checkForUpdate());

// ---- IPC: open external (allow-listed to this repo's releases only) -------
ipcMain.handle('open-external', async (_event, url) => {
  const allowedPrefix = `${RELEASES_URL}/`;
  if (typeof url !== 'string' || (!url.startsWith(allowedPrefix) && url !== RELEASES_URL)) {
    return { ok: false, error: 'url-not-allowed' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

// ---- IPC: tray ------------------------------------------------------------
ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) mainWindow.hide();
});
