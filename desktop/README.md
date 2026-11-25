# Ghost Video Editor Bangla — Electron Desktop App

Ghost Video Editor Bangla — trim, split, merge and style videos, with a Bangla UI.
A professional video editor for Windows (Electron desktop app).

## Features

- **Open a video** — preview it in the built-in player (MP4, MKV, MOV, WebM, AVI).
- **Trim** — set start / end in seconds (or "now" from the playhead) and export the cut.
- **Split** — split the clip at the current playhead position into two files.
- **Merge** — pick several clips and join them into one MP4 (concat, no re-encode). With a fade/slide transition or a preset, clips are re-encoded and joined with ffmpeg `xfade`.
- **Text overlay** — burn text onto the video (position + size; uses a system font).
- **Filters** — brightness and contrast sliders.
- **Speed** — 0.25×–4×, with audio pitch following (atempo); optional mute.
- **Subtitles (SRT)** — v1.1.0: pick an `.srt` file, see cues timed over the preview, burn them into the export with ffmpeg's `subtitles` filter.
- **Background music** — v1.1.0: pick a music file, hear it under the preview with fade-in/out, mix it into the export (or as a standalone job).
- **Transitions** — v1.1.0: fade / slide between clips when merging, plus a "play all clips" preview that crossfades between clips.
- **Export presets** — v1.1.0: Original, 720p, 1080p, Vertical 9:16 (1080×1920). Presets scale to fit and pad — nothing is cropped.
- **Export** — applies all current settings in one ffmpeg pass to MP4, with a live progress bar.
- **History** — last 50 exports, stored in localStorage, with live search by filename.
- **Tray** — closing the window hides it to the tray (Show / Check for update / Quit).
- **Update check** — compares the app version with the latest GitHub release; never auto-downloads, only opens the releases page.

## How to run

```bash
cd desktop
npm install
npm start
```

## How to build (Windows installer + portable exe)

```bash
cd desktop
npm run build:win
```

The installer and portable exe appear under `dist/`. GitHub Actions can build the
same artifact (see the repo workflow).

## How it works

- The main process spawns the `ffmpeg-static` binary (a runtime dependency, so it
  ships inside the app) for every video operation.
- Video info comes from `ffmpeg -i <file>` (ffprobe is **not** shipped with
  ffmpeg-static), parsed from stderr.
- Export progress is parsed from ffmpeg's `time=` output and sent to the
  renderer as `export-progress` events.
- The renderer never touches Node or ffmpeg directly — everything goes through
  the `window.ghostVideoEditor` bridge in `preload.js` (context isolation on).

## Honest limits

- Export is always **MP4** (H.264 + AAC). Big files take time — that is ffmpeg
  re-encoding, not a bug.
- **Merge uses `-c copy`** (no transition, no preset): clips must share the same codec/container. Mismatched
  clips fail with ffmpeg's error instead of silently producing a broken file. With a transition or preset, clips are normalised and re-encoded, so mixed clips work.
- **Subtitles use ffmpeg's `subtitles` filter (libass)** — Bangla shapes correctly when a Bangla font is installed; if libass/font is missing on the machine, the subtitle job fails with ffmpeg's error instead of burning garbage.
- **Music + mute**: mute wins — if mute is on, the export has no audio at all, including no music.
- **Transition preview**: after the crossfade the main preview restarts the next clip from its beginning (a small jump of up to the transition length); the exported merge has no such jump.
- **Text overlay needs a font file** on the computer (bundled `assets/` font first,
  then DejaVu / Noto Sans Bengali / Arial). If none is found, the text job is
  refused with a clear message instead of crashing.
- Preview uses a `file://` URL, so very long paths or unusual characters may
  not preview — the edit/export still works on the file itself.
- History lives in localStorage (max 50 entries) on this computer only.
- The update check needs internet; it fails silently offline and never
  downloads anything by itself.

## License

MIT — tunnabri-ops
