'use strict';

/* Ghost Video Editor Bangla — renderer.
 * Flow: pick video -> preview (file://) + getVideoInfo() -> set trim/text/
 * filter/speed options -> each action calls its ffmpeg op in main via
 * window.ghostVideoEditor (preload bridge) -> result saved to history
 * (localStorage, max 50). Export runs all settings in one ffmpeg pass and
 * reports progress through onExportProgress / onExportDone / onExportError.
 */

const $ = (id) => document.getElementById(id);

const preview = $('preview');
const preview2 = $('preview2');
const musicAudio = $('musicAudio');
const subtitleOverlayEl = $('subtitleOverlay');
const previewEmpty = $('previewEmpty');
const clipInfoEl = $('clipInfo');
const clipListEl = $('clipList');
const historyListEl = $('historyList');
const historySearchEl = $('historySearch');
const historyCountEl = $('historyCount');
const statusText = $('statusText');
const timeNowEl = $('timeNow');
const timeTotalEl = $('timeTotal');
const updateBanner = $('updateBanner');
const updateStatusEl = $('updateStatus');
const progressWrap = $('progressWrap');
const progressFill = $('progressFill');
const progressText = $('progressText');

const HISTORY_KEY = 'gve-history';
const HISTORY_MAX = 50;

const state = {
  currentPath: null,
  currentName: null,
  duration: null, // seconds (from get-video-info) or null
  clips: [], // merge candidates: { path, name }
  history: [], // { name, path, op, time }
  busy: false,
  pendingUpdateUrl: null,
  subtitlePath: null, // v1.1.0
  subCues: [], // v1.1.0: { start, end, text }
  musicPath: null, // v1.1.0
  playingAll: false, // v1.1.0
};

// ---- v1.1.0: SRT subtitles ----------------------------------------------
function parseSrtTime(s) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(String(s || '').trim());
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}

function parseSRT(text) {
  const cues = [];
  String(text || '').replace(/^\uFEFF/, '').split(/\r?\n\r?\n/).forEach((block) => {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    let ti = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('-->') !== -1) { ti = i; break; }
    }
    if (ti < 0) return;
    const parts = lines[ti].split('-->');
    const start = parseSrtTime(parts[0]);
    const end = parseSrtTime(parts[1] || '');
    if (start === null || end === null || end <= start) return;
    const txt = lines.slice(ti + 1).join('\n').trim();
    if (txt) cues.push({ start, end, text: txt });
  });
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

function subtitleAt(cues, t) {
  for (const cue of cues) {
    if (t >= cue.start && t < cue.end) return cue.text;
  }
  return '';
}

function updateSubtitleOverlay() {
  if (!subtitleOverlayEl) return;
  subtitleOverlayEl.textContent = state.subCues.length
    ? subtitleAt(state.subCues, preview.currentTime || 0)
    : '';
}

// ---- v1.1.0: background music preview ------------------------------------
function musicVolumeNow() {
  if (!musicAudio || !state.musicPath) return 0;
  const base = (parseInt($('musicVol').value, 10) || 0) / 100;
  const t = preview.currentTime || 0;
  const fi = parseFloat($('musicFadeIn').value) || 0;
  const fo = parseFloat($('musicFadeOut').value) || 0;
  const start = parseFloat($('trimStart').value) || 0;
  const end = $('trimEnd').value === '' ? state.duration : parseFloat($('trimEnd').value);
  let f = 1;
  if (fi > 0 && t - start < fi) f = Math.max(0, (t - start) / fi);
  if (fo > 0 && end && end - t < fo) f = Math.min(f, Math.max(0, (end - t) / fo));
  return Math.max(0, Math.min(1, base * f));
}

function syncMusic() {
  if (!musicAudio || !state.musicPath) return;
  if (musicAudio.paused && !preview.paused && !preview.muted) {
    musicAudio.play().catch(() => {});
  }
  musicAudio.volume = musicVolumeNow();
}

function fmt(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function fmtFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function setStatus(text, kind) {
  statusText.textContent = text;
  statusText.className = 'status' + (kind ? ` ${kind}` : '');
}

function setBusy(busy) {
  state.busy = busy;
  ['btnPickVideo', 'btnPickVideos', 'btnMerge', 'btnTrim', 'btnSplit',
   'btnApplyText', 'btnApplyFilter', 'btnApplySpeed', 'btnExport',
   'btnAddSubtitles', 'btnAddMusic'].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = busy || el.dataset.noClip === '1';
  });
  updateButtons();
}

function updateButtons() {
  const hasClip = !!state.currentPath;
  const hasMerge = state.clips.length >= 2;
  $('btnMerge').disabled = state.busy || !hasMerge;
  $('btnTrim').disabled = state.busy || !hasClip;
  $('btnSplit').disabled = state.busy || !hasClip;
  $('btnApplyText').disabled = state.busy || !hasClip;
  $('btnApplyFilter').disabled = state.busy || !hasClip;
  $('btnApplySpeed').disabled = state.busy || !hasClip;
  $('btnExport').disabled = state.busy || !hasClip;
  $('btnAddSubtitles').disabled = state.busy || !hasClip || !state.subtitlePath;
  $('btnAddMusic').disabled = state.busy || !hasClip || !state.musicPath;
}

function showProgress(percent) {
  progressWrap.classList.remove('hidden');
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
}

function hideProgress() {
  progressWrap.classList.add('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '০%';
}

// ---- Clip loading ---------------------------------------------------------
function loadPreview(filePath) {
  preview.src = `file://${encodeURI(filePath)}`;
  previewEmpty.classList.add('hidden');
}

async function selectClip(filePath) {
  transitionStarted = false;
  state.currentPath = filePath;
  state.currentName = filePath.split(/[\\/]/).pop();
  loadPreview(filePath);
  setStatus('ভিডিওর তথ্য নেওয়া হচ্ছে…', 'busy');
  try {
    const info = await window.ghostVideoEditor.getVideoInfo(filePath);
    if (info && info.ok) {
      state.duration = info.duration;
      const parts = [
        `📄 ${info.name}`,
        `⏱ ${info.duration ? fmt(info.duration) : 'অজানা দৈর্ঘ্য'}`,
        info.width ? `🖼 ${info.width}×${info.height}` : null,
        info.fps ? `${info.fps} fps` : null,
        info.codec ? info.codec : null,
        fmtFileSize(info.size),
      ].filter(Boolean);
      clipInfoEl.textContent = parts.join(' · ');
      timeTotalEl.textContent = fmt(info.duration);
      if (info.duration) $('trimEnd').value = info.duration.toFixed(1);
    } else {
      state.duration = null;
      clipInfoEl.textContent = `📄 ${state.currentName} (তথ্য পাওয়া যায়নি: ${(info && info.error) || 'অজানা'})`;
    }
  } catch (err) {
    state.duration = null;
    clipInfoEl.textContent = `📄 ${state.currentName}`;
    setStatus(`তথ্য নেওয়া যায়নি: ${err.message || err}`, 'error');
  }
  setStatus('প্রস্তুত — এডিট করুন', '');
  updateButtons();
}

function renderClipList() {
  clipListEl.innerHTML = '';
  state.clips.forEach((clip) => {
    const li = document.createElement('li');
    if (clip.path === state.currentPath) li.classList.add('selected');
    const nameEl = document.createElement('div');
    nameEl.textContent = clip.name;
    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.textContent = clip.path;
    li.appendChild(nameEl);
    li.appendChild(metaEl);
    li.addEventListener('click', () => selectClip(clip.path));
    clipListEl.appendChild(li);
  });
  updateButtons();
}

async function pickSingle() {
  try {
    const result = await window.ghostVideoEditor.pickVideo();
    if (result && !result.cancelled && result.path) {
      state.clips = [{ path: result.path, name: result.path.split(/[\\/]/).pop() }];
      renderClipList();
      await selectClip(result.path);
    }
  } catch (err) {
    setStatus(`ভিডিও খোলা যায়নি: ${err.message || err}`, 'error');
  }
}

async function pickMultiple() {
  try {
    const result = await window.ghostVideoEditor.pickVideos();
    if (result && !result.cancelled && result.paths && result.paths.length) {
      state.clips = result.paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() }));
      renderClipList();
      await selectClip(result.paths[0]);
      setStatus(`${result.paths.length}টি ক্লিপ বেছে নেওয়া হয়েছে — মার্জ করতে পারবেন`, '');
    }
  } catch (err) {
    setStatus(`ভিডিও খোলা যায়নি: ${err.message || err}`, 'error');
  }
}

// ---- v1.1.0: play all clips with transition preview ----------------------
let transitionStarted = false;

function nextClipAfterCurrent() {
  const i = state.clips.findIndex((c) => c.path === state.currentPath);
  return (i >= 0 && i + 1 < state.clips.length) ? state.clips[i + 1] : null;
}

function startTransitionTo(next) {
  if (transitionStarted || !next) return;
  transitionStarted = true;
  const trans = $('transitionSelect').value;
  const dur = Math.max(0.1, Math.min(2, parseFloat($('transitionDur').value) || 0.5));
  preview2.src = `file://${encodeURI(next.path)}`;
  preview2.playbackRate = preview.playbackRate;
  preview2.muted = preview.muted;
  preview2.style.transition = 'none';
  preview2.style.opacity = '0';
  preview2.style.transform = 'translateX(0)';
  preview2.play().catch(() => {});
  const ms = Math.round(dur * 1000);
  preview2.style.transition = `opacity ${dur}s linear, transform ${dur}s linear`;
  preview.style.transition = `opacity ${dur}s linear, transform ${dur}s linear`;
  if (trans === 'slide') {
    preview2.style.transform = 'translateX(100%)';
    requestAnimationFrame(() => {
      preview2.style.transform = 'translateX(0)';
      preview.style.transform = 'translateX(-100%)';
    });
  } else {
    requestAnimationFrame(() => { preview2.style.opacity = '1'; });
  }
  setTimeout(() => {
    preview.pause();
    preview.style.transition = 'none';
    preview.style.transform = 'translateX(0)';
    preview2.style.transition = 'none';
    preview2.style.opacity = '0';
    preview2.style.transform = 'translateX(0)';
    preview2.pause();
    preview2.removeAttribute('src');
    preview2.load();
    transitionStarted = false;
    selectClip(next.path).then(() => {
      if (state.playingAll) preview.play().catch(() => {});
    });
  }, ms);
}

async function playAllClips() {
  if (!state.clips.length) return;
  state.playingAll = true;
  transitionStarted = false;
  await selectClip(state.clips[0].path);
  preview.play().catch((err) => setStatus(`ভিডিও চালানো যায়নি: ${err.message || err}`, 'error'));
}

// ---- Edit actions ---------------------------------------------------------
function currentSettings() {
  return {
    input: state.currentPath,
    start: parseFloat($('trimStart').value) || 0,
    end: $('trimEnd').value === '' ? undefined : parseFloat($('trimEnd').value),
    speed: parseFloat($('speedSelect').value) || 1,
    brightness: parseInt($('brightness').value, 10) || 0,
    contrast: parseInt($('contrast').value, 10) || 100,
    text: $('textInput').value.trim(),
    textPosition: $('textPosition').value,
    textSize: parseInt($('textSize').value, 10) || 48,
    mute: $('muteCheck').checked,
    subtitlePath: state.subtitlePath, // v1.1.0
    subtitleFontSize: 40, // v1.1.0 (fixed size; SRT burn uses libass default styling)
    musicPath: state.musicPath, // v1.1.0
    musicVolume: (parseInt($('musicVol').value, 10) || 0) / 100,
    fadeIn: parseFloat($('musicFadeIn').value) || 0,
    fadeOut: parseFloat($('musicFadeOut').value) || 0,
    preset: $('presetSelect').value, // v1.1.0
  };
}

function describeError(result) {
  if (!result) return 'অজানা ত্রুটি';
  if (result.error === 'font-missing') return 'ফন্ট পাওয়া যায়নি — এই কম্পিউটারে টেক্সটের ফন্ট নেই, তাই টেক্সট বসানো যায়নি';
  if (result.error === 'ffmpeg-missing') return 'ffmpeg পাওয়া যায়নি — অ্যাপটি আবার ইনস্টল করুন';
  if (result.error === 'need-two-clips') return 'মার্জ করতে অন্তত ২টি ক্লিপ লাগবে';
  if (result.error === 'invalid-range') return 'শুরু/শেষ সময় ঠিক নেই';
  if (result.error === 'invalid-split-point') return 'স্প্লিটের জায়গাটি ঠিক নেই';
  if (result.error === 'split-after-end') return 'স্প্লিটের জায়গা ভিডিওর শেষের পরে';
  if (result.error === 'empty-text') return 'টেক্সট লিখুন';
  if (result.error === 'file-not-found') return 'ফাইলটি পাওয়া যায়নি';
  if (result.error === 'subtitle-missing') return 'সাবটাইটেল (SRT) ফাইল পাওয়া যায়নি';
  if (result.error === 'music-missing') return 'মিউজিক ফাইল পাওয়া যায়নি';
  if (result.error === 'invalid-volume') return 'মিউজিকের ভলিউম ০ থেকে ১-এর মধ্যে হতে হবে';
  if (result.error === 'invalid-preset') return 'প্রিসেটটি ঠিক নেই';
  if (result.error === 'invalid-transition') return 'ট্রানজিশনটি ঠিক নেই';
  if (result.error === 'clip-too-short') return 'কোনো ক্লিপ ট্রানজিশনের দৈর্ঘ্যের চেয়ে ছোট';
  return result.detail ? `${result.error}: ${result.detail}` : (result.error || 'অজানা ত্রুটি');
}

function handleResult(result, opLabel) {
  if (!result) {
    setStatus(`${opLabel} ব্যর্থ হয়েছে`, 'error');
    return;
  }
  if (result.cancelled) {
    setStatus('বাতিল করা হয়েছে', '');
    return;
  }
  if (result.ok && result.path) {
    addHistory(opLabel, result.path.split(/[\\/]/).pop(), result.path);
    if (result.path2) addHistory(opLabel, result.path2.split(/[\\/]/).pop(), result.path2);
    setStatus(`${opLabel} হয়েছে ✓`, 'done');
    hideProgress();
  } else {
    setStatus(`${opLabel} হয়নি: ${describeError(result)}`, 'error');
    hideProgress();
  }
}

async function doTrim() {
  if (!state.currentPath) return;
  const s = currentSettings();
  setBusy(true);
  setStatus('ট্রিম হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.trimVideo({ input: s.input, start: s.start, end: s.end });
    handleResult(result, 'ট্রিম');
  } catch (err) {
    setStatus(`ট্রিম হয়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doSplit() {
  if (!state.currentPath || !preview.duration) {
    alert('প্রথমে ভিডিও চালিয়ে স্প্লিটের জায়গায় থামান।');
    return;
  }
  const at = preview.currentTime;
  if (!at || at <= 0) {
    alert('স্প্লিট করতে ভিডিওটি কিছুটা চালিয়ে থামান।');
    return;
  }
  setBusy(true);
  setStatus(`স্প্লিট হচ্ছে (${fmt(at)})…`, 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.splitVideo({ input: state.currentPath, at });
    handleResult(result, 'স্প্লিট');
  } catch (err) {
    setStatus(`স্প্লিট হয়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doMerge() {
  if (state.clips.length < 2) return;
  setBusy(true);
  setStatus('মার্জ হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.mergeVideos({
      inputs: state.clips.map((c) => c.path),
      transition: $('transitionSelect').value,
      transitionDuration: parseFloat($('transitionDur').value) || 0.5,
      preset: $('presetSelect').value,
    });
    handleResult(result, 'মার্জ');
  } catch (err) {
    setStatus(`মার্জ হয়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

// ---- v1.1.0: subtitles / music actions ------------------------------------
async function pickSubtitleFile() {
  try {
    const result = await window.ghostVideoEditor.pickSubtitle();
    if (result && !result.cancelled && result.path) {
      const read = await window.ghostVideoEditor.readSubtitleFile(result.path);
      if (!read || !read.ok) {
        setStatus('SRT ফাইল পড়া যায়নি', 'error');
        return;
      }
      const cues = parseSRT(read.text);
      if (!cues.length) {
        setStatus('SRT ফাইলে কোনো সাবটাইটেল পাওয়া যায়নি', 'error');
        return;
      }
      state.subtitlePath = result.path;
      state.subCues = cues;
      $('subtitleInfo').textContent = `📄 ${result.path.split(/[\\/]/).pop()} — ${cues.length}টি সাবটাইটেল`;
      $('btnClearSubtitle').classList.remove('hidden');
      updateSubtitleOverlay();
      updateButtons();
      setStatus('সাবটাইটেল লোড হয়েছে ✓', 'done');
    }
  } catch (err) {
    setStatus(`সাবটাইটেল খোলা যায়নি: ${err.message || err}`, 'error');
  }
}

async function pickMusicFile() {
  try {
    const result = await window.ghostVideoEditor.pickMusic();
    if (result && !result.cancelled && result.path) {
      state.musicPath = result.path;
      musicAudio.src = `file://${encodeURI(result.path)}`;
      $('musicInfo').textContent = `🎵 ${result.path.split(/[\\/]/).pop()}`;
      $('btnClearMusic').classList.remove('hidden');
      updateButtons();
      setStatus('মিউজিক লোড হয়েছে ✓', 'done');
    }
  } catch (err) {
    setStatus(`মিউজিক খোলা যায়নি: ${err.message || err}`, 'error');
  }
}

async function doAddSubtitles() {
  if (!state.currentPath || !state.subtitlePath) return;
  setBusy(true);
  setStatus('সাবটাইটেল বসানো হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.addSubtitles({
      input: state.currentPath, subtitlePath: state.subtitlePath, fontSize: 40,
    });
    handleResult(result, 'সাবটাইটেল');
  } catch (err) {
    setStatus(`সাবটাইটেল বসানো যায়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doAddMusic() {
  if (!state.currentPath || !state.musicPath) return;
  const s = currentSettings();
  setBusy(true);
  setStatus('মিউজিক যোগ করা হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.addMusic({
      input: s.input, musicPath: s.musicPath, musicVolume: s.musicVolume,
      fadeIn: s.fadeIn, fadeOut: s.fadeOut,
    });
    handleResult(result, 'মিউজিক');
  } catch (err) {
    setStatus(`মিউজিক যোগ করা যায়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doAddText() {
  if (!state.currentPath) return;
  const s = currentSettings();
  if (!s.text) {
    alert('প্রথমে টেক্সট লিখুন।');
    return;
  }
  setBusy(true);
  setStatus('টেক্সট বসানো হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.addText({
      input: s.input, text: s.text, textPosition: s.textPosition, textSize: s.textSize,
    });
    handleResult(result, 'টেক্সট');
  } catch (err) {
    setStatus(`টেক্সট বসানো যায়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doApplyFilter() {
  if (!state.currentPath) return;
  const s = currentSettings();
  setBusy(true);
  setStatus('ফিল্টার লাগানো হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.applyFilter({
      input: s.input, brightness: s.brightness, contrast: s.contrast,
    });
    handleResult(result, 'ফিল্টার');
  } catch (err) {
    setStatus(`ফিল্টার লাগানো যায়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doChangeSpeed() {
  if (!state.currentPath) return;
  const s = currentSettings();
  setBusy(true);
  setStatus('গতি বদলানো হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.changeSpeed({
      input: s.input, speed: s.speed, mute: s.mute,
    });
    handleResult(result, 'গতি');
  } catch (err) {
    setStatus(`গতি বদলানো যায়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

async function doExport() {
  if (!state.currentPath) return;
  const s = currentSettings();
  setBusy(true);
  setStatus('এক্সপোর্ট হচ্ছে…', 'busy');
  showProgress(0);
  try {
    const result = await window.ghostVideoEditor.exportVideo(s);
    // Progress/done/error also arrive as events; the invoke result is the
    // final word. If main already sent export-done, this just confirms it.
    if (result && result.ok && result.path) {
      addHistory('এক্সপোর্ট', result.path.split(/[\\/]/).pop(), result.path);
      setStatus('এক্সপোর্ট হয়েছে ✓', 'done');
    } else if (result && result.cancelled) {
      setStatus('বাতিল করা হয়েছে', '');
    } else if (result && !result.ok) {
      setStatus(`এক্সপোর্ট হয়নি: ${describeError(result)}`, 'error');
    }
  } catch (err) {
    setStatus(`এক্সপোর্ট হয়নি: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
    hideProgress();
  }
}

// ---- History (localStorage, max 50) ---------------------------------------
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    state.history = Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX) : [];
  } catch (_err) {
    state.history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, HISTORY_MAX)));
  } catch (_err) { /* storage full / unavailable — history is best-effort */ }
}

function addHistory(op, name, filePath) {
  state.history.unshift({ op, name, path: filePath, time: new Date().toLocaleString('bn-BD') });
  state.history = state.history.slice(0, HISTORY_MAX);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const q = (historySearchEl.value || '').trim().toLowerCase();
  const shown = state.history.filter((h) => !q || h.name.toLowerCase().includes(q) || (h.op || '').toLowerCase().includes(q));
  historyCountEl.textContent = `${state.history.length}টি`;
  if (!shown.length) {
    historyListEl.innerHTML = state.history.length
      ? '<li class="empty">খুঁজে কিছু পাওয়া যায়নি।</li>'
      : '<li class="empty">এখনো কিছু এক্সপোর্ট হয়নি।</li>';
    return;
  }
  historyListEl.innerHTML = '';
  shown.forEach((h) => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = h.op || 'এক্সপোর্ট';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.appendChild(badge);
    nameEl.appendChild(document.createTextNode(h.name));
    const pathEl = document.createElement('div');
    pathEl.className = 'file-path';
    pathEl.textContent = h.path;
    const metaEl = document.createElement('div');
    metaEl.className = 'file-meta';
    metaEl.textContent = h.time;
    li.appendChild(nameEl);
    li.appendChild(pathEl);
    li.appendChild(metaEl);
    historyListEl.appendChild(li);
  });
}

// ---- Update check ---------------------------------------------------------
function showUpdate(result) {
  if (!result) return;
  if (result.updateAvailable && result.version) {
    $('updateVersion').textContent = `v${result.version}`;
    $('currentVersion').textContent = `v${result.currentVersion || ''}`;
    state.pendingUpdateUrl = result.url;
    updateBanner.classList.remove('hidden');
    updateStatusEl.textContent = `নতুন ভার্সন v${result.version} এসেছে`;
  } else {
    updateStatusEl.textContent = 'আপনি সর্বশেষ ভার্সন ব্যবহার করছেন ✓';
  }
}

async function runUpdateCheck() {
  updateStatusEl.textContent = 'আপডেট দেখা হচ্ছে…';
  try {
    const result = await window.ghostVideoEditor.checkForUpdate();
    showUpdate(result);
  } catch (_err) {
    updateStatusEl.textContent = '';
  }
}

// ---- Wire up --------------------------------------------------------------
$('btnPickVideo').addEventListener('click', pickSingle);
$('btnPickVideos').addEventListener('click', pickMultiple);
$('btnMerge').addEventListener('click', doMerge);
$('btnTrim').addEventListener('click', doTrim);
$('btnSplit').addEventListener('click', doSplit);
$('btnApplyText').addEventListener('click', doAddText);
$('btnApplyFilter').addEventListener('click', doApplyFilter);
$('btnApplySpeed').addEventListener('click', doChangeSpeed);
$('btnExport').addEventListener('click', doExport);
$('btnPickSubtitle').addEventListener('click', pickSubtitleFile);
$('btnPickMusic').addEventListener('click', pickMusicFile);
$('btnAddSubtitles').addEventListener('click', doAddSubtitles);
$('btnAddMusic').addEventListener('click', doAddMusic);
$('btnPlayAll').addEventListener('click', playAllClips);
$('btnClearSubtitle').addEventListener('click', () => {
  state.subtitlePath = null;
  state.subCues = [];
  $('subtitleInfo').textContent = 'কোনো সাবটাইটেল লোড হয়নি।';
  $('btnClearSubtitle').classList.add('hidden');
  updateSubtitleOverlay();
  updateButtons();
});
$('btnClearMusic').addEventListener('click', () => {
  state.musicPath = null;
  if (musicAudio) { musicAudio.pause(); musicAudio.removeAttribute('src'); }
  $('musicInfo').textContent = 'কোনো মিউজিক লোড হয়নি।';
  $('btnClearMusic').classList.add('hidden');
  updateButtons();
});
$('musicVol').addEventListener('input', (e) => {
  $('musicVolVal').textContent = `${e.target.value}%`;
  syncMusic();
});
$('btnSetStart').addEventListener('click', () => { $('trimStart').value = preview.currentTime.toFixed(1); });
$('btnSetEnd').addEventListener('click', () => { $('trimEnd').value = preview.currentTime.toFixed(1); });
$('brightness').addEventListener('input', (e) => { $('brightnessVal').textContent = e.target.value; });
$('contrast').addEventListener('input', (e) => { $('contrastVal').textContent = e.target.value; });
$('btnUpdate').addEventListener('click', runUpdateCheck);
$('btnTray').addEventListener('click', () => window.ghostVideoEditor.minimizeToTray());
$('btnDismissUpdate').addEventListener('click', () => updateBanner.classList.add('hidden'));
$('btnDownloadUpdate').addEventListener('click', () => {
  if (state.pendingUpdateUrl) window.ghostVideoEditor.openExternal(state.pendingUpdateUrl);
});
historySearchEl.addEventListener('input', renderHistory);

preview.addEventListener('timeupdate', () => {
  timeNowEl.textContent = fmt(preview.currentTime);
  updateSubtitleOverlay();
  syncMusic();
  // v1.1.0: play-all — start the crossfade into the next clip just
  // before this clip ends (or jump straight to it when transition=none).
  if (state.playingAll && preview.duration) {
    const next = nextClipAfterCurrent();
    if (next) {
      const trans = $('transitionSelect').value;
      const dur = Math.max(0.1, Math.min(2, parseFloat($('transitionDur').value) || 0.5));
      if (trans !== 'none' && preview.currentTime >= preview.duration - dur) {
        startTransitionTo(next);
      } else if (trans === 'none' && preview.currentTime >= preview.duration - 0.05 && !transitionStarted) {
        transitionStarted = true;
        selectClip(next.path).then(() => preview.play().catch(() => {}));
      }
    } else if (preview.currentTime >= preview.duration - 0.05) {
      state.playingAll = false;
    }
  }
});
preview.addEventListener('ended', () => {
  if (musicAudio) musicAudio.pause();
  if (state.playingAll) {
    const next = nextClipAfterCurrent();
    if (next) {
      selectClip(next.path).then(() => preview.play().catch(() => {}));
    } else {
      state.playingAll = false;
    }
  }
});
preview.addEventListener('pause', () => {
  if (musicAudio) musicAudio.pause();
});
preview.addEventListener('loadedmetadata', () => {
  if (!state.duration) timeTotalEl.textContent = fmt(preview.duration);
});

// Export progress / completion events from main.
window.ghostVideoEditor.onExportProgress((data) => {
  if (data && typeof data.percent === 'number') showProgress(data.percent);
});
window.ghostVideoEditor.onExportDone((data) => {
  if (data && data.path) setStatus('এক্সপোর্ট হয়েছে ✓', 'done');
});
window.ghostVideoEditor.onExportError((data) => {
  setStatus(`এক্সপোর্ট হয়নি: ${describeError(data)}`, 'error');
  hideProgress();
});

// Tray menu's "Check for update" sends its result back through this event.
window.ghostVideoEditor.onUpdateAvailable((result) => showUpdate(result));

// Init
loadHistory();
renderHistory();
updateButtons();
runUpdateCheck();
