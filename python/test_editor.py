"""Headless tests for Ghost Video Editor Bangla (python/editor.py).

Run:  python3 test_editor.py        (or: python3 -m unittest test_editor -v)

Generates synthetic clips with ffmpeg (testsrc video + sine audio) in a
temp dir — no display, no GUI, no network. Uses the bundled
imageio-ffmpeg binary when installed, otherwise a system ffmpeg.

v1.1.0 tests: SRT parsing / subtitle burn, clip transitions (fade/slide),
background-music mixing, export presets — plus regression tests for the
v1.0.0 operations (trim / split / merge / text / speed / export).
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from PIL import Image

from editor import (
    EditorError, add_music, add_subtitles, add_text, apply_filter,
    change_speed, export_mp4, ffmpeg_exe, merge, parse_srt, preset_resolution,
    probe, split, subtitle_at, trim,
)

SRT_SAMPLE = """1
00:00:01,000 --> 00:00:03,000
হ্যালো দুনিয়া

2
00:00:04,000 --> 00:00:05,500
Second line here
"""


def _make_clip(path: Path, duration: float = 6.0, color: str = "red",
               size: str = "320x240", with_audio: bool = True) -> Path:
    """Synthetic clip: solid-colour testsrc + optional sine audio."""
    args = [ffmpeg_exe(), "-hide_banner", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=size={size}:rate=25:duration={duration}"]
    if with_audio:
        args += ["-f", "lavfi", "-i",
                 f"sine=frequency=440:duration={duration}"]
        args += ["-c:v", "libx264", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-shortest", str(path)]
    else:
        args += ["-c:v", "libx264", "-pix_fmt", "yuv420p",
                 "-an", str(path)]
    subprocess.run(args, check=True, timeout=300)
    return path


def _make_tone(path: Path, duration: float = 10.0,
               frequency: int = 880) -> Path:
    """Synthetic music file: a plain sine tone (WAV)."""
    subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={duration}",
         "-c:a", "pcm_s16le", str(path)],
        check=True, timeout=300)
    return path


def _frame_array(video: Path, t: float) -> np.ndarray:
    """One decoded frame at time t as a float RGB array."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        png = Path(tmp.name)
    subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-y", "-loglevel", "error",
         "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
         str(png)],
        check=True, timeout=120)
    arr = np.asarray(Image.open(png).convert("RGB"), dtype=float)
    png.unlink(missing_ok=True)
    return arr


def _mean_diff(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a - b)))


class TestSrt(unittest.TestCase):
    def test_parse_srt(self):
        cues = parse_srt(SRT_SAMPLE)
        self.assertEqual(len(cues), 2)
        self.assertAlmostEqual(cues[0]["start"], 1.0)
        self.assertAlmostEqual(cues[0]["end"], 3.0)
        self.assertEqual(cues[0]["text"], "হ্যালো দুনিয়া")
        self.assertEqual(cues[1]["text"], "Second line here")

    def test_parse_srt_from_file(self):
        with tempfile.NamedTemporaryFile("w", suffix=".srt",
                                        delete=False, encoding="utf-8") as f:
            f.write(SRT_SAMPLE)
            path = f.name
        try:
            self.assertEqual(len(parse_srt(path)), 2)
        finally:
            Path(path).unlink(missing_ok=True)

    def test_parse_srt_empty_raises(self):
        with self.assertRaises(EditorError):
            parse_srt("no timing lines here at all")

    def test_subtitle_at(self):
        cues = parse_srt(SRT_SAMPLE)
        self.assertEqual(subtitle_at(cues, 2.0), "হ্যালো দুনিয়া")
        self.assertEqual(subtitle_at(cues, 4.5), "Second line here")
        self.assertEqual(subtitle_at(cues, 0.5), "")
        self.assertEqual(subtitle_at(cues, 3.5), "")
        self.assertEqual(subtitle_at(cues, 6.0), "")

    def test_preset_resolution(self):
        self.assertEqual(preset_resolution("720p"), (1280, 720))
        self.assertEqual(preset_resolution("1080p"), (1920, 1080))
        self.assertEqual(preset_resolution("vertical"), (1080, 1920))
        self.assertIsNone(preset_resolution("original"))
        with self.assertRaises(EditorError):
            preset_resolution("4k")


class EngineTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="gve-test-"))
        cls.clip_a = _make_clip(cls.tmp / "a.mp4", duration=6.0, color="red")
        cls.clip_b = _make_clip(cls.tmp / "b.mp4", duration=4.0, color="red",
                                size="320x240")
        cls.music = _make_tone(cls.tmp / "music.wav", duration=10.0)
        cls.srt = cls.tmp / "subs.srt"
        cls.srt.write_text(SRT_SAMPLE, encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.tmp, ignore_errors=True)


class TestSubtitles(EngineTestBase):
    def test_burn_changes_pixels_only_inside_cue(self):
        out = self.tmp / "subbed.mp4"
        add_subtitles(self.clip_a, out, self.srt, font_size=36)
        info = probe(out)
        self.assertAlmostEqual(info["duration"], 6.0, delta=0.2)
        src_in = _frame_array(self.clip_a, 2.0)
        out_in = _frame_array(out, 2.0)
        src_out = _frame_array(self.clip_a, 5.8)
        out_out = _frame_array(out, 5.8)
        inside = _mean_diff(src_in, out_in)
        outside = _mean_diff(src_out, out_out)
        # Subtitle text (white + outline) must change pixels at t=2s,
        # and leave the frame (almost) untouched at t=5.8s (after cue 2).
        self.assertGreater(inside, 0.5,
                           f"subtitle did not change pixels inside cue (Δ={inside:.2f})")
        self.assertLess(outside, inside * 0.5,
                        f"subtitle leaked outside cue (inside Δ={inside:.2f}, outside Δ={outside:.2f})")

    def test_burn_bad_srt_raises(self):
        with self.assertRaises(EditorError):
            add_subtitles(self.clip_a, self.tmp / "bad.mp4", "not an srt")


class TestTransitions(EngineTestBase):
    def test_fade_duration_and_blended_middle(self):
        out = self.tmp / "fade.mp4"
        merge([self.clip_a, self.clip_b], out,
              transition="fade", transition_duration=0.5)
        info = probe(out)
        # 6 + 4 − 0.5 overlap = 9.5 s
        self.assertAlmostEqual(info["duration"], 9.5, delta=0.3)
        # Middle of the transition (t=5.75) blends both clips; it must
        # differ from a pure frame of either clip.
        mid = _frame_array(out, 5.75)
        pure_a = _frame_array(self.clip_a, 1.0)
        pure_b = _frame_array(self.clip_b, 1.0)
        self.assertGreater(_mean_diff(mid, pure_a), 0.5)
        self.assertGreater(_mean_diff(mid, pure_b), 0.5)

    def test_slide_duration(self):
        out = self.tmp / "slide.mp4"
        merge([self.clip_a, self.clip_b], out,
              transition="slide", transition_duration=0.5)
        info = probe(out)
        self.assertAlmostEqual(info["duration"], 9.5, delta=0.3)

    def test_transition_bad_name_raises(self):
        with self.assertRaises(EditorError):
            merge([self.clip_a, self.clip_b], self.tmp / "x.mp4",
                  transition="wipe")

    def test_transition_longer_than_clip_raises(self):
        short = _make_clip(self.tmp / "short.mp4", duration=0.4)
        with self.assertRaises(EditorError):
            merge([short, self.clip_b], self.tmp / "x.mp4",
                  transition="fade", transition_duration=0.5)


class TestMusic(EngineTestBase):
    def test_music_mix_duration_and_audio(self):
        out = self.tmp / "music.mp4"
        add_music(self.clip_a, out, self.music,
                  music_volume=0.5, fade_in=1.0, fade_out=1.0)
        info = probe(out)
        self.assertAlmostEqual(info["duration"], 6.0, delta=0.2)
        self.assertTrue(info["has_audio"])
        self.assertGreater(out.stat().st_size, 10_000)

    def test_music_on_silent_video(self):
        silent = _make_clip(self.tmp / "silent.mp4", duration=3.0,
                            with_audio=False)
        out = self.tmp / "silent-music.mp4"
        add_music(silent, out, self.music, music_volume=0.7)
        info = probe(out)
        self.assertTrue(info["has_audio"])
        self.assertAlmostEqual(info["duration"], 3.0, delta=0.2)

    def test_music_bad_volume_raises(self):
        with self.assertRaises(EditorError):
            add_music(self.clip_a, self.tmp / "x.mp4", self.music,
                      music_volume=1.5)

    def test_music_missing_file_raises(self):
        with self.assertRaises(EditorError):
            add_music(self.clip_a, self.tmp / "x.mp4",
                      self.tmp / "no-such-file.wav")


class TestPresets(EngineTestBase):
    def test_preset_720p(self):
        out = self.tmp / "p720.mp4"
        export_mp4(self.clip_a, out, preset="720p")
        info = probe(out)
        self.assertEqual((info["width"], info["height"]), (1280, 720))

    def test_preset_1080p(self):
        out = self.tmp / "p1080.mp4"
        export_mp4(self.clip_a, out, preset="1080p")
        info = probe(out)
        self.assertEqual((info["width"], info["height"]), (1920, 1080))

    def test_preset_vertical(self):
        out = self.tmp / "pvert.mp4"
        export_mp4(self.clip_a, out, preset="vertical")
        info = probe(out)
        self.assertEqual((info["width"], info["height"]), (1080, 1920))

    def test_preset_original_keeps_size(self):
        out = self.tmp / "porig.mp4"
        export_mp4(self.clip_a, out, preset="original")
        info = probe(out)
        self.assertEqual((info["width"], info["height"]), (320, 240))

    def test_preset_bad_name_raises(self):
        with self.assertRaises(EditorError):
            export_mp4(self.clip_a, self.tmp / "x.mp4", preset="4k")


class TestRegression(EngineTestBase):
    """v1.0.0 operations must still work after the v1.1.0 changes."""

    def test_probe(self):
        info = probe(self.clip_a)
        self.assertAlmostEqual(info["duration"], 6.0, delta=0.2)
        self.assertEqual((info["width"], info["height"]), (320, 240))
        self.assertTrue(info["has_audio"])

    def test_trim(self):
        out = self.tmp / "trim.mp4"
        trim(self.clip_a, out, 1.0, 4.0)
        self.assertAlmostEqual(probe(out)["duration"], 3.0, delta=0.2)

    def test_split(self):
        o1, o2 = split(self.clip_a, self.tmp / "s1.mp4",
                       self.tmp / "s2.mp4", 2.5)
        self.assertAlmostEqual(probe(o1)["duration"], 2.5, delta=0.3)
        self.assertAlmostEqual(probe(o2)["duration"], 3.5, delta=0.3)

    def test_merge_plain(self):
        out = self.tmp / "merged.mp4"
        merge([self.clip_a, self.clip_b], out)
        self.assertAlmostEqual(probe(out)["duration"], 10.0, delta=0.3)

    def test_text_overlay(self):
        out = self.tmp / "text.mp4"
        add_text(self.clip_a, out, "শুভ নববর্ষ", "bottom", 36)
        self.assertAlmostEqual(probe(out)["duration"], 6.0, delta=0.2)

    def test_filter(self):
        out = self.tmp / "filt.mp4"
        apply_filter(self.clip_a, out, brightness=0.2, contrast=1.3)
        self.assertAlmostEqual(probe(out)["duration"], 6.0, delta=0.2)

    def test_speed(self):
        out = self.tmp / "fast.mp4"
        change_speed(self.clip_a, out, 2.0)
        self.assertAlmostEqual(probe(out)["duration"], 3.0, delta=0.3)

    def test_export(self):
        out = self.tmp / "exp.mp4"
        export_mp4(self.clip_a, out)
        self.assertAlmostEqual(probe(out)["duration"], 6.0, delta=0.2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
