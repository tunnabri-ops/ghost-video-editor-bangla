'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The ONLY bridge the renderer gets. No Node, no ipcRenderer is exposed
// directly — all ffmpeg work happens in main, the renderer only talks
// through these methods. Events (export-progress / export-done /
// export-error / update-available) arrive from main; each listener
// returns an unsubscribe function.
contextBridge.exposeInMainWorld('ghostVideoEditor', {
  // Pick one video file. Returns { cancelled, path }.
  pickVideo: () => ipcRenderer.invoke('pick-video'),

  // Pick several video files (for merge). Returns { cancelled, paths }.
  pickVideos: () => ipcRenderer.invoke('pick-videos'),

  // Probe a file with ffmpeg -i. Returns
  // { ok, path, name, size, duration, codec, width, height, fps, hasAudio, error? }.
  getVideoInfo: (filePath) => ipcRenderer.invoke('get-video-info', filePath),

  // Trim: { input, start, end, output? } (seconds). Returns { ok, path, cancelled?, error?, detail? }.
  trimVideo: (payload) => ipcRenderer.invoke('trim-video', payload),

  // Split at a time: { input, at, output?, output2? }. Returns { ok, path, path2, error? }.
  splitVideo: (payload) => ipcRenderer.invoke('split-video', payload),

  // Merge clips in order: { inputs, output?, transition ('none'|'fade'|'slide'),
  // transitionDuration, preset }. Returns { ok, path, error? }.
  mergeVideos: (payload) => ipcRenderer.invoke('merge-videos', payload),

  // Burn text on the video: { input, text, textPosition, textSize, output? }.
  // Returns { ok, path, error? } ('font-missing' when no font file is found).
  addText: (payload) => ipcRenderer.invoke('add-text', payload),

  // Brightness/contrast: { input, brightness (-100..100), contrast (0..200), output? }.
  applyFilter: (payload) => ipcRenderer.invoke('apply-filter', payload),

  // Speed: { input, speed (0.25..4), mute, output? }. Audio pitch follows via atempo.
  changeSpeed: (payload) => ipcRenderer.invoke('change-speed', payload),

  // Pick an SRT subtitle file. Returns { cancelled, path }.
  pickSubtitle: () => ipcRenderer.invoke('pick-subtitle'),

  // Pick a music/audio file. Returns { cancelled, path }.
  pickMusic: () => ipcRenderer.invoke('pick-music'),

  // Read an SRT file as text. Returns { ok, text, error? }.
  readSubtitleFile: (filePath) => ipcRenderer.invoke('read-subtitle-file', filePath),

  // Burn SRT subtitles into the video: { input, subtitlePath, fontSize, output? }.
  addSubtitles: (payload) => ipcRenderer.invoke('add-subtitles', payload),

  // Mix background music under the clip audio:
  // { input, musicPath, musicVolume (0..1), fadeIn, fadeOut, output? }.
  addMusic: (payload) => ipcRenderer.invoke('add-music', payload),

  // Full export with all current settings in one ffmpeg pass:
  // { input, start, end, speed, brightness, contrast, text, textPosition,
  //   textSize, mute, output?, subtitlePath, subtitleFontSize,
  //   musicPath, musicVolume, fadeIn, fadeOut, preset }. Progress arrives
  // via onExportProgress, then onExportDone / onExportError.
  exportVideo: (payload) => ipcRenderer.invoke('export-video', payload),

  // Ask where to save: { defaultName }. Returns { cancelled, path }.
  saveDialog: (defaultName) => ipcRenderer.invoke('save-dialog', defaultName),

  // Opens a URL — main only allows this repo's releases page. Returns { ok, error? }.
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Hide the window to the tray (tray menu: Show / Check for update / Quit).
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),

  // Returns { updateAvailable, version, url, currentVersion }. Never downloads.
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  // Fired while an export runs: { percent, seconds, totalSeconds }.
  onExportProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },

  // Fired when an export finishes: { path }.
  onExportDone: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-done', listener);
    return () => ipcRenderer.removeListener('export-done', listener);
  },

  // Fired when an export fails: { error, detail? }.
  onExportError: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-error', listener);
    return () => ipcRenderer.removeListener('export-error', listener);
  },

  // Fired when the tray menu's "Check for update" runs, and when a manual
  // check finds a newer release: { updateAvailable, version, url, currentVersion }.
  onUpdateAvailable: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
});
