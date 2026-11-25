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
- **Subtitles (SRT)** — v1.1.0: load an `.srt` file, see it timed in the preview, burn it into the export
- **Clip transitions** — v1.1.0: fade / slide between clips when merging (desktop + Python) or exporting all clips together (web)
- **Background music** — v1.1.0: mix a music track under the clip audio, with fade-in / fade-out
- **Export presets** — v1.1.0: Original, 720p (1280×720), 1080p (1920×1080), Vertical 9:16 (1080×1920, for Shorts/Reels)

## 🆕 What's new in v1.1.0

1. **Subtitle track** — add `.srt` subtitles: they show timed in the preview and are burned into the export. Python renders each cue with Pillow (Bangla-safe); web draws them on the export canvas; Electron uses ffmpeg's `subtitles` filter (libass).
2. **Clip transitions** — fade (cross-dissolve) and slide (slide-left) between clips. Python and Electron merge use ffmpeg `xfade` (+ `acrossfade` for audio); web crossfades on canvas when playing/exporting all clips together, and in the preview when playing all clips.
3. **Background music + volume fade** — pick a music file; it is mixed under the clip audio (looped to the video length) with fade-in at the start and fade-out at the end. Python and Electron mix with ffmpeg; web mixes with WebAudio in the preview and into the export recording.
4. **Export presets** — 720p, 1080p and vertical 9:16 (1080×1920) alongside the original size. Presets scale to fit and pad with black — nothing is cropped and the picture is never stretched. Web exports WebM at the preset size; Python and Electron export MP4.

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
- Vertical 9:16 presets pad the frame with black bars to 1080×1920 — nothing is cropped.
- Electron transition preview restarts the next clip from its beginning after the crossfade (a jump of up to the transition length); the exported merge has no such jump.
- Nothing is ever uploaded anywhere — all three versions edit fully on your own machine.

## 🇧🇩 বাংলা

**Ghost Video Editor বাংলা — সবার জন্য বাংলা ভিডিও এডিটর।**

- ভিডিও কাটা (ট্রিম), ভাগ করা (স্প্লিট), জোড়া দেওয়া (মার্জ)
- ভিডিওর উপর লেখা বসানো — বাংলা লেখা ঠিকমতো দেখাবে
- উজ্জ্বলতা / কন্ট্রাস্ট, গতি বদলানো, শব্দ বন্ধ করা
- সাবটাইটেল (SRT), ক্লিপের মাঝে ফেড/স্লাইড ট্রানজিশন, ব্যাকগ্রাউন্ড মিউজিক (ফেড ইন/আউটসহ), এক্সপোর্ট প্রিসেট (720p/1080p/ভার্টিকাল 9:16)
- ওয়েবে WebM, ডেস্কটপে MP4 এক্সপোর্ট
- বাংলা ইন্টারফেস, ডার্ক ডিজাইন, এডিট হিস্ট্রি

## 📄 License

MIT — use it however you like; credit is appreciated.
