"""
Ghost Video Editor Bangla — video editing engine.

Pure functions, no GUI imports, so this module can be imported and
tested headless.

All video work runs through the ffmpeg binary bundled with
``imageio-ffmpeg`` — no system ffmpeg install is required.

Text overlay: text is rendered to a transparent PNG with Pillow
(raqm shaping, so Bangla conjuncts render correctly) and composited
with ffmpeg's ``overlay`` filter. We deliberately do NOT use ffmpeg's
``drawtext`` filter: it cannot shape complex Bangla script and it
needs fragile shell escaping for Bangla text.

Public API:
    probe(input) -> dict with duration / width / height / fps / has_audio
    trim(input, output, start, end)
    split(input, output1, output2, at_seconds)
    merge([inputs], output)
    add_text(input, output, text, position, font_size)
    apply_filter(input, output, brightness, contrast)
    change_speed(input, output, factor)
    export_mp4(input, output)
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional, Union

PathLike = Union[str, Path]


class EditorError(Exception):
    """User-facing error, in Bangla + English."""


# ---------------------------------------------------------------------------
# ffmpeg access + probing
# ---------------------------------------------------------------------------

def ffmpeg_exe() -> str:
    """Path to the bundled ffmpeg binary (imageio-ffmpeg)."""
    try:
        import imageio_ffmpeg
    except ImportError as exc:  # noqa: BLE001
        raise EditorError(
            "ffmpeg পাওয়া যায়নি — imageio-ffmpeg ইনস্টল করুন।\n"
            "ffmpeg not found — please install imageio-ffmpeg."
        ) from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def _run_ffmpeg(args: List[str], what: str) -> None:
    """Run ffmpeg with the bundled binary; raise EditorError on failure."""
    cmd = [ffmpeg_exe(), "-hide_banner", "-y", "-loglevel", "error"] + args
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=3600,
        )
    except subprocess.TimeoutExpired as exc:
        raise EditorError(
            f"{what} — সময় শেষ হয়ে গেছে (timeout)।\n{what} timed out."
        ) from exc
    except OSError as exc:
        raise EditorError(
            f"{what} — ffmpeg চালানো যায়নি: {exc}\n"
            f"{what} — could not run ffmpeg: {exc}"
        ) from exc
    if result.returncode != 0:
        detail = (result.stderr or "").strip()[:500]
        raise EditorError(
            f"{what} ব্যর্থ হয়েছে।\n{what} failed. {detail}"
        )


def _run_ffmpeg_info(args: List[str]) -> str:
    """Run ffmpeg -i (info only); ffmpeg prints probe info to stderr."""
    cmd = [ffmpeg_exe(), "-hide_banner", "-i"] + args
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return result.stderr or ""


_DURATION_RE = re.compile(r"Duration: (\d+):(\d+):([\d.]+)")
_STREAM_RE = re.compile(
    # ", 320x240" — the comma guards against codec tags like 0x31637661.
    r"Stream #\d+:\d+.*?: Video: .*?, (\d+)x(\d+).*? (\d+(?:\.\d+)?) fps"
)
_AUDIO_RE = re.compile(r"Stream #\d+:\d+.*?: Audio:")


def probe(input_path: PathLike) -> dict:
    """Return video info: duration (s), width, height, fps, has_audio.

    Uses ``ffmpeg -i`` parsing because imageio-ffmpeg ships only ffmpeg
    (no ffprobe binary).
    """
    path = Path(input_path)
    if not path.exists():
        raise EditorError(
            f"ফাইল পাওয়া যায়নি: {path}\nFile not found: {path}"
        )
    info = _run_ffmpeg_info([str(path)])
    duration = 0.0
    match = _DURATION_RE.search(info)
    if match:
        hours, minutes, seconds = match.groups()
        duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    width = height = 0
    fps = 0.0
    stream = _STREAM_RE.search(info)
    if stream:
        width, height = int(stream.group(1)), int(stream.group(2))
        fps = float(stream.group(3))
    if duration <= 0 and width == 0:
        raise EditorError(
            f"ভিডিও তথ্য পড়া যায়নি: {path}\n"
            f"Could not read video info: {path}"
        )
    return {
        "path": str(path),
        "duration": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "has_audio": bool(_AUDIO_RE.search(info)),
    }


def _check_input(input_path: PathLike) -> Path:
    path = Path(input_path)
    if not path.exists():
        raise EditorError(
            f"ফাইল পাওয়া যায়নি: {path}\nFile not found: {path}"
        )
    return path


def _check_output(output_path: PathLike) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _has_audio(input_path: PathLike) -> bool:
    try:
        return probe(input_path)["has_audio"]
    except EditorError:
        return False


# ---------------------------------------------------------------------------
# Editing operations
# ---------------------------------------------------------------------------

def trim(input_path: PathLike, output_path: PathLike,
         start: float, end: float) -> str:
    """Cut [start, end) seconds out of a video (re-encoded, frame-accurate).

    Returns the output path.
    """
    src = _check_input(input_path)
    dst = _check_output(output_path)
    if start < 0 or end <= start:
        raise EditorError(
            "শুরু/শেষ সময় সঠিক নয় (শেষ > শুরু ≥ 0 হতে হবে)।\n"
            "Invalid trim range: need 0 <= start < end."
        )
    info = probe(src)
    if end > info["duration"] + 0.05:
        raise EditorError(
            f"শেষ সময় ভিডিওর দৈর্ঘ্য ({info['duration']:.2f} সেকেন্ড) "
            "ছাড়িয়ে গেছে।\n"
            f"End time exceeds video duration ({info['duration']:.2f}s)."
        )
    length = end - start
    _run_ffmpeg(
        ["-ss", f"{start:.3f}", "-i", str(src),
         "-t", f"{length:.3f}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-movflags", "+faststart",
         str(dst)],
        "ট্রিম (Trim)",
    )
    return str(dst)


def split(input_path: PathLike, output1: PathLike, output2: PathLike,
          at_seconds: float) -> tuple[str, str]:
    """Split a video at ``at_seconds`` into two clips.

    Returns (output1, output2). Both parts are re-encoded MP4.
    """
    src = _check_input(input_path)
    info = probe(src)
    if at_seconds <= 0 or at_seconds >= info["duration"]:
        raise EditorError(
            f"ভাগের সময় ভিডিওর ভেতরে হতে হবে "
            f"(0 < সময় < {info['duration']:.2f} সেকেন্ড)।\n"
            f"Split point must be inside the video "
            f"(0 < time < {info['duration']:.2f}s)."
        )
    out1 = trim(src, output1, 0, at_seconds)
    out2 = trim(src, output2, at_seconds, info["duration"])
    return out1, out2


def merge(inputs: List[PathLike], output_path: PathLike) -> str:
    """Join several videos into one MP4 (re-encoded, so mixed sizes work).

    Uses the concat demuxer with re-encode: inputs are first normalised
    to the same codec / size / fps, then concatenated.
    Returns the output path.
    """
    if not inputs or len(inputs) < 2:
        raise EditorError(
            "মার্জ করতে অন্তত ২টি ভিডিও লাগবে।\n"
            "Merging needs at least 2 videos."
        )
    paths = [_check_input(p) for p in inputs]
    dst = _check_output(output_path)

    # Normalise every clip to the first clip's resolution/fps, then concat.
    first = probe(paths[0])
    width, height, fps = first["width"], first["height"], first["fps"] or 25
    # Even dimensions are required by libx264 (yuv420p).
    width = width - (width % 2)
    height = height - (height % 2)

    with tempfile.TemporaryDirectory(prefix="ghost-editor-merge-") as tmpdir:
        tmpdir = Path(tmpdir)
        normed: List[Path] = []
        for i, src in enumerate(paths):
            tmp = tmpdir / f"part{i}.mp4"
            _run_ffmpeg(
                ["-i", str(src),
                 "-vf", f"scale={width}:{height},fps={fps},format=yuv420p",
                 "-c:v", "libx264", "-c:a", "aac",
                 "-video_track_timescale", "90000",
                 str(tmp)],
                "মার্জ — প্রস্তুতি (Merge — normalising)",
            )
            normed.append(tmp)
        concat_file = tmpdir / "concat.txt"
        concat_file.write_text(
            "".join(f"file '{p}'\n" for p in normed), encoding="utf-8"
        )
        _run_ffmpeg(
            ["-f", "concat", "-safe", "0", "-i", str(concat_file),
             "-c", "copy", "-movflags", "+faststart", str(dst)],
            "মার্জ (Merge)",
        )
    return str(dst)


def _find_font() -> Optional[str]:
    """Best font file for text overlay: Bangla first, then DejaVu."""
    candidates = [
        # Bangla (Noto Sans Bengali ships on most Linux desktops)
        "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansBengali-Bold.ttf",
        # Windows
        r"C:\Windows\Fonts\Nirmala.ttf",
        r"C:\Windows\Fonts\SolaimanLipi.ttf",
        # macOS fallback handled by DejaVu below; Latin fallback
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return path
    return None


def render_text_png(text: str, font_size: int, width: int,
                    font_path: Optional[str] = None) -> Path:
    """Render text to a transparent PNG sized to the video width.

    Uses Pillow with raqm (when available) so Bangla conjuncts shape
    correctly. Returns the PNG path (a temp file; caller deletes it).
    """
    from PIL import Image, ImageDraw, ImageFont

    font_path = font_path or _find_font()
    if font_path is None:
        raise EditorError(
            "টেক্সটের জন্য কোনো ফন্ট পাওয়া যায়নি।\n"
            "No font found for text overlay."
        )
    font = ImageFont.truetype(font_path, size=int(font_size))
    # Measure with a dummy canvas, then render with padding + outline.
    dummy = Image.new("RGBA", (10, 10))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    pad = max(8, font_size // 3)
    img = Image.new("RGBA", (max(text_w + 2 * pad, 1), text_h + 2 * pad),
                    (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    x = pad - bbox[0]
    y = pad - bbox[1]
    # Dark outline so white text stays readable on any background.
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255),
              stroke_width=max(2, font_size // 16), stroke_fill=(0, 0, 0, 220))
    tmp = tempfile.NamedTemporaryFile(
        prefix="ghost-editor-text-", suffix=".png", delete=False)
    tmp.close()
    img.save(tmp.name, format="PNG")
    return Path(tmp.name)


def add_text(input_path: PathLike, output_path: PathLike, text: str,
             position: str = "bottom", font_size: int = 48) -> str:
    """Burn text onto the video for its full duration.

    ``position``: "top" | "center" | "bottom". Returns the output path.
    """
    src = _check_input(input_path)
    dst = _check_output(output_path)
    if not text or not text.strip():
        raise EditorError(
            "টেক্সট খালি — কিছু লিখুন।\nText is empty — please type something."
        )
    if position not in ("top", "center", "bottom"):
        raise EditorError(
            "অবস্থান top / center / bottom হতে হবে।\n"
            "Position must be top, center or bottom."
        )
    info = probe(src)
    overlay_png = render_text_png(text.strip(), font_size, info["width"])
    try:
        y_expr = {
            "top": "20",
            "center": "(main_h-overlay_h)/2",
            "bottom": "main_h-overlay_h-20",
        }[position]
        _run_ffmpeg(
            ["-i", str(src), "-i", str(overlay_png),
             "-filter_complex",
             f"[0:v][1:v]overlay=(main_w-overlay_w)/2:{y_expr}",
             "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-c:a", "copy",
             "-movflags", "+faststart", str(dst)],
            "টেক্সট যোগ (Add text)",
        )
    finally:
        overlay_png.unlink(missing_ok=True)
    return str(dst)


def apply_filter(input_path: PathLike, output_path: PathLike,
                 brightness: float = 0.0, contrast: float = 1.0) -> str:
    """Adjust brightness (-1..1) and contrast (0..2) with ffmpeg's eq filter.

    Returns the output path.
    """
    src = _check_input(input_path)
    dst = _check_output(output_path)
    if not -1.0 <= brightness <= 1.0:
        raise EditorError(
            "উজ্জ্বলতা -1 থেকে 1 এর মধ্যে হতে হবে।\n"
            "Brightness must be between -1 and 1."
        )
    if not 0.0 <= contrast <= 2.0:
        raise EditorError(
            "কনট্রাস্ট 0 থেকে 2 এর মধ্যে হতে হবে।\n"
            "Contrast must be between 0 and 2."
        )
    _run_ffmpeg(
        ["-i", str(src),
         "-vf", f"eq=brightness={brightness:.3f}:contrast={contrast:.3f}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "copy",
         "-movflags", "+faststart", str(dst)],
        "ফিল্টার (Filter)",
    )
    return str(dst)


def change_speed(input_path: PathLike, output_path: PathLike,
                 factor: float = 1.0) -> str:
    """Change playback speed. ``factor`` > 1 = faster, < 1 = slower.

    Video uses setpts; audio (if present) uses atempo in chained steps
    (atempo only accepts 0.5–2.0 per step). Returns the output path.
    """
    src = _check_input(input_path)
    dst = _check_output(output_path)
    if factor <= 0 or factor > 4.0:
        raise EditorError(
            "গতি 0 থেকে 4 এর মধ্যে হতে হবে।\n"
            "Speed factor must be between 0 and 4."
        )
    has_audio = _has_audio(src)
    video_filter = f"setpts={1.0 / factor:.6f}*PTS"
    args: List[str] = ["-i", str(src)]
    if has_audio:
        # Chain atempo filters so any factor in (0, 4] works.
        remaining = factor
        steps: List[str] = []
        while remaining > 2.0:
            steps.append("atempo=2.0")
            remaining /= 2.0
        while remaining < 0.5:
            steps.append("atempo=0.5")
            remaining /= 0.5
        steps.append(f"atempo={remaining:.6f}")
        audio_filter = ",".join(steps)
        args += ["-filter_complex",
                 f"[0:v]{video_filter}[v];[0:a]{audio_filter}[a]",
                 "-map", "[v]", "-map", "[a]"]
    else:
        args += ["-vf", video_filter]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-movflags", "+faststart", str(dst)]
    _run_ffmpeg(args, "গতি পরিবর্তন (Change speed)")
    return str(dst)


def export_mp4(input_path: PathLike, output_path: PathLike) -> str:
    """Re-encode any supported video to H.264 MP4 (yuv420p, faststart).

    Returns the output path.
    """
    src = _check_input(input_path)
    dst = _check_output(output_path)
    if dst.suffix.lower() != ".mp4":
        dst = dst.with_suffix(".mp4")
    _run_ffmpeg(
        ["-i", str(src),
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-movflags", "+faststart",
         str(dst)],
        "এক্সপোর্ট (Export)",
    )
    return str(dst)


__all__ = [
    "EditorError",
    "add_text",
    "apply_filter",
    "change_speed",
    "export_mp4",
    "ffmpeg_exe",
    "merge",
    "probe",
    "render_text_png",
    "split",
    "trim",
]
