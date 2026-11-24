# 👻 Ghost Video Editor Bangla

[![Video Editor](https://img.shields.io/badge/type-video%20editor-blue)](https://github.com/tunnabri-ops/ghost-video-editor-bangla)
[![Platforms](https://img.shields.io/badge/platforms-Web%20%7C%20Python%20%7C%20Electron-green)](https://github.com/tunnabri-ops/ghost-video-editor-bangla)
[![Language](https://img.shields.io/badge/UI-Bangla%20%2B%20English-orange)](https://github.com/tunnabri-ops/ghost-video-editor-bangla)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](https://github.com/tunnabri-ops/ghost-video-editor-bangla/blob/main/README.md#%F0%9F%93%84-license)

**A Bangla-first video editor for everyone — web, Python desktop, and Electron desktop in one project.**

**Trim, split, merge and style your videos — with a Bangla-first interface and three ways to run it.**

> বাংলা সংস্করণ নিচে আছে। / Bangla version below.

## ✨ Features

- **Trim** — pick a start and end time; preview loops inside the trim
- **Split** — cut a clip at the playhead into two segments
- **Merge** — join several clips into one video, in order
- **Text overlay** — burn text onto the video (top / center / bottom, adjustable size); Bangla text shapes correctly
- **Filters** — brightness / contrast / saturation sliders
- **Speed** — 0.5× / 1× / 1.5× / 2× playback and export
- **Mute / unmute** — drop the audio track when you want silence
- **Timeline / clip list** — every segment is visible with start–end and duration; click to select, delete what you don't need
- **Export with progress** — a real progress bar while the video renders
- **History** (web + desktop) — your past edits are saved (max 50), searchable on desktop
- **Minimize to tray** (Electron desktop) — closing the window hides it in the system tray
- **Update check** (Electron desktop) — checks GitHub releases and tells you when a newer version is out; never downloads anything by itself

## 🚀 Three versions

| Version | Folder | Run it |
|---|---|---|
| 🌐 Web app | `web/` | Open `index.html` in a browser — nothing to install; exports to WebM |
| 🐍 Python desktop | `python/` | `pip install -r requirements.txt` → `python app.py`; exports to MP4 |
| 🖥️ Desktop app | `desktop/` | `npm install` → `npm start` (Windows `.exe` is built by GitHub Actions); exports to MP4 |

### Web

Open `web/index.html` in a modern browser. Pick a video file (or drag & drop it), edit, and export. Export draws the video to a canvas and records it to WebM with `MediaRecorder`.

### Python desktop

```bash
cd python
pip install -r requirements.txt
python app.py
```

Uses the `imageio-ffmpeg` bundled ffmpeg binary — **no system ffmpeg needed**. Text is rendered with Pillow so Bangla conjuncts shape correctly (Noto Sans Bengali is picked up automatically when installed).

### Electron desktop

```bash
cd desktop
npm install
npm start
```

Export runs the bundled `ffmpeg-static` binary. A Windows installer + portable exe is built automatically by GitHub Actions on every push to `main` (see `.github/workflows/build-exe.yml`).

## ⚠️ Honest limits

- The **web version exports WebM, not MP4** — browsers can't write MP4. Use the Python or Electron app for MP4.
- Web export records in real time (a 1-minute clip takes about 1 minute to export); big files are slow.
- Web history stores file names and settings only — local files can't be re-opened from history; pick the file again.
- The Python app has no live video preview timeline yet (it shows duration, resolution and FPS); merge normalises later clips to the first clip's resolution.
- Electron preview uses a `file://` URL — very long or unusual paths may not preview, but editing and export still work on the file itself.
- Nothing is ever uploaded anywhere — all three versions edit fully on your own machine.

## 🇧🇩 বাংলা

**Ghost Video Editor বাংলা — সবার জন্য বাংলা ভিডিও এডিটর।**

- ভিডিও কাটা (ট্রিম), ভাগ করা (স্প্লিট), জোড়া দেওয়া (মার্জ)
- ভিডিওর উপর লেখা বসানো — বাংলা লেখা ঠিকমতো দেখাবে
- উজ্জ্বলতা / কন্ট্রাস্ট, গতি বদলানো, শব্দ বন্ধ করা
- ওয়েবে WebM, ডেস্কটপে MP4 এক্সপোর্ট
- বাংলা ইন্টারফেস, ডার্ক ডিজাইন, এডিট হিস্ট্রি

## 📄 License

MIT — use it however you like; credit is appreciated.
