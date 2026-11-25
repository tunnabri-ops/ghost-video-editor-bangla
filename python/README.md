# Ghost Video Editor Bangla — Python Desktop App

Professional video editor with a dark Bangla UI (PySide6).

## Features

- ✂️ **Trim** — cut any start/end range (frame-accurate, re-encoded)
- 🔪 **Split** — split one video into two clips at any time
- 🔗 **Merge** — join 2+ clips into one MP4 (different sizes/FPS are normalised)
- 🔤 **Text overlay** — Bangla text (top / center / bottom), rendered with Pillow so Bangla conjuncts shape correctly
- 🎨 **Filter** — brightness (−1…1) and contrast (0…2) sliders
- ⏩ **Speed** — 0.5× / 1.0× / 1.5× / 2.0× (video + audio stay in sync)
- 💬 **Subtitles (SRT)** — v1.1.0: pick an `.srt` file and burn timed subtitles into the video (Pillow-rendered, Bangla-safe)
- 🔀 **Transitions** — v1.1.0: fade / slide between clips when merging (`xfade` + `acrossfade`)
- 🎵 **Background music** — v1.1.0: mix a music track under the clip audio, with fade-in / fade-out
- 📐 **Export presets** — v1.1.0: Original / 720p (1280×720) / 1080p (1920×1080) / Vertical 9:16 (1080×1920)
- ⬇️ **Export** — re-encode to H.264 MP4 (yuv420p, faststart)
- 📜 History list — double-click any output to open it

## Install & Run

```bash
pip install -r requirements.txt
python app.py
```

Requires Python 3.9+ and a display (Windows / macOS / Linux desktop).

## Files

- `app.py` — PySide6 GUI (dark Bangla UI; long jobs run in a worker thread)
- `editor.py` — editing engine (no GUI imports, headless-testable)
- `test_editor.py` — headless tests (`python3 -m unittest test_editor -v`)
- `requirements.txt` — dependencies

## How it works

All video work runs through the ffmpeg binary bundled with
`imageio-ffmpeg` — **no system ffmpeg install is needed**. If that
package is missing, a system `ffmpeg` on PATH is used instead.

- **Text overlay:** text is rendered to a transparent PNG with Pillow
  (raqm shaping, so Bangla conjuncts render correctly) and composited
  with ffmpeg's `overlay` filter. ffmpeg's `drawtext` filter is
  deliberately not used — it cannot shape complex Bangla script.
- **Merge:** clips are first normalised to the first clip's resolution
  and FPS, then joined with the concat demuxer. With
  `transition="fade"` / `"slide"`, they are joined with ffmpeg `xfade`
  (+ `acrossfade` for audio when every clip has it) instead.
- **Speed:** video uses `setpts`; audio uses chained `atempo` filters
  so any factor in (0, 4] works.
- **Subtitles:** each cue is rendered to a PNG with Pillow and composited
  with an `overlay` filter enabled only between the cue's start/end times.
- **Music:** the music file is looped to the video length and mixed with
  `amix`; fade-in/out use `afade`. If the video has no audio, the music
  becomes the audio track.
- **Presets:** `export_mp4(..., preset="720p"|"1080p"|"vertical")` scales
  to fit inside the target and pads with black — nothing is cropped.

## Honest limits

- No live video preview / timeline scrubbing — the GUI shows duration,
  resolution, FPS and audio info, and edits run as background jobs.
  (A preview player would need a media backend such as VLC/QtMultimedia.)
  Subtitles and music can be picked and burned/mixed, but there is no
  timed subtitle preview or music playback in the Python GUI.
- No stickers, keyframes or audio-track editing — this is a
  trim/split/merge/text/filter/speed editor, not a full NLE.
- Text overlay uses the first Bangla font found on the system
  (Noto Sans Bengali on Linux, Nirmala on Windows). If no font is found,
  text overlay fails with a clear message.
- Editing re-encodes video, so very long 4K files can take a while;
  there is no GPU acceleration.
- The GUI itself has not been run on a real display in this build
  environment (headless VM, and PySide6 cannot even start there —
  `libEGL.so.1` is missing). GUI wiring was verified statically instead:
  `py_compile` passes and all 14 buttons have a connected slot, with
  every referenced slot method defined.

## Headless test results (v1.1.0 — 2026-11-26, this VM)

`python3 -m unittest test_editor -v` — **28/28 passed** against synthetic
testsrc clips (320×240, 25 fps, sine audio) using the system ffmpeg
(`imageio-ffmpeg` was not installed in this VM, so the engine fell back
to the system binary):

| Test | Result |
|---|---|
| SRT parse (2 cues, Bangla + Latin) + `subtitle_at` at 5 times | all correct |
| subtitle burn: pixels change inside cue 1 (t=2 s), not after cue 2 (t=5.8 s) | inside Δ 6.45, outside Δ 0.39 |
| merge fade 0.5 s (6 s + 4 s) | 9.5 s; middle frame blends both clips |
| merge slide 0.5 s | 9.5 s |
| music mix (fade-in/out 1 s, vol 0.5) | 6.00 s, audio present |
| music on silent video | 3.00 s, audio present |
| export preset 720p / 1080p / vertical / original | 1280×720 / 1920×1080 / 1080×1920 / 320×240 |
| 8 regression tests (probe/trim/split/merge/text/filter/speed/export) | all pass |
| 7 error paths (bad SRT/preset/transition/volume/missing files, short clip) | all raise `EditorError` |

Two bugs were found and fixed while testing: the subtitle filter chain
first dropped the previous overlay's input label, then duplicated the
`[0:v]` input; and the test itself sampled "outside" at t=5.0 s, which
is inside cue 2 (04:00–05:50) — the sample moved to 5.8 s.

## Headless test results (2026-11-24, this VM)

`python3 /tmp/gve_test.py` — **30/30 passed** against synthetic
testsrc clips (320×240, 25 fps, sine audio) using the bundled ffmpeg:

| Test | Result |
|---|---|
| probe (6 s clip) | duration 6.00 s, 320×240, 25 fps, audio detected |
| trim 1.0 → 4.0 s | 3.00 s, 45,319 bytes |
| split at 2.5 s | part 1: 2.52 s, part 2: 3.52 s (sum 6.04 s) |
| merge 6 s + 4 s | 10.02 s, 143,803 bytes |
| merge mixed sizes (320×240 + 640×360) | 8.02 s, normalised to 320×240 |
| text overlay, Bangla "শুভ নববর্ষ" (bottom) | 109,192 bytes, 6.00 s; pixels differ from source (mean Δ 8.87) |
| text overlay, Latin (top) / Bangla (center) | 88,623 / 88,144 bytes |
| filter brightness +0.2, contrast 1.3 | 86,340 bytes, 6.00 s; pixels differ (mean Δ 22.61) |
| speed 2.0× (with audio) | 3.08 s |
| speed 0.5× (with audio) | 11.98 s |
| speed 1.5× (no audio) | 2.04 s |
| export_mp4 | 85,990 bytes, 6.00 s |
| 9 error paths (bad trim/split/merge/text/filter/speed/missing file) | all raise `EditorError` |

One probe bug was found and fixed during testing: the resolution regex
first matched the codec tag `0x31637661` instead of `320x240`.
