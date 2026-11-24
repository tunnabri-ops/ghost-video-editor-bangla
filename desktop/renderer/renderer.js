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
};

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
   'btnApplyText', 'btnApplyFilter', 'btnApplySpeed', 'btnExport'].forEach((id) => {
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
    const result = await window.ghostVideoEditor.mergeVideos({ inputs: state.clips.map((c) => c.path) });
    handleResult(result, 'মার্জ');
  } catch (err) {
    setStatus(`মার্জ হয়নি: ${err.message || err}`, 'error');
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
