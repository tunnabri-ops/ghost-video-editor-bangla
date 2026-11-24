# Ghost Video Editor Bangla — Electron Desktop App

Ghost Video Editor Bangla — trim, split, merge and style videos, with a Bangla UI.
A professional video editor for Windows (Electron desktop app).

## Features

- **Open a video** — preview it in the built-in player (MP4, MKV, MOV, WebM, AVI).
- **Trim** — set start / end in seconds (or "now" from the playhead) and export the cut.
- **Split** — split the clip at the current playhead position into two files.
- **Merge** — pick several clips and join them into one MP4 (concat, no re-encode).
- **Text overlay** — burn text onto the video (position + size; uses a system font).
- **Filters** — brightness and contrast sliders.
- **Speed** — 0.25×–4×, with audio pitch following (atempo); optional mute.
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
- **Merge uses `-c copy`**: clips must share the same codec/container. Mismatched
  clips fail with ffmpeg's error instead of silently producing a broken file.
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
