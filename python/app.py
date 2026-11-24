"""
Ghost Video Editor Bangla — PySide6 desktop app.

Professional video editor with a dark Bangla UI: trim, split, merge,
text overlay, brightness/contrast filters, speed change, MP4 export.

Run:
    pip install -r requirements.txt
    python app.py

Long ffmpeg jobs run in a background thread so the UI stays responsive.
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path

from PySide6.QtCore import Qt, Signal, QObject
from PySide6.QtWidgets import (
    QApplication, QComboBox, QDoubleSpinBox, QFileDialog, QGroupBox,
    QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QMainWindow, QMessageBox, QProgressBar, QPushButton, QSlider,
    QStatusBar, QVBoxLayout, QWidget,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))

from editor import (  # noqa: E402
    EditorError, add_text, apply_filter, change_speed, export_mp4,
    merge, probe, split, trim,
)

APP_TITLE = "Ghost Video Editor Bangla — ভিডিও এডিটর"
DEFAULT_DIR = Path.home() / "Videos" / "GhostVideoEditorBangla"

DARK_STYLE = """
QWidget { background-color: #12141a; color: #e8eaf0; font-size: 14px; }
QPushButton {
    background-color: #2b6cb0; color: white; border: none;
    border-radius: 8px; padding: 10px 14px; font-weight: bold;
}
QPushButton:hover { background-color: #3182ce; }
QPushButton:disabled { background-color: #3a3f4b; color: #9aa0ae; }
QPushButton#danger { background-color: #c53030; }
QPushButton#danger:hover { background-color: #e53e3e; }
QPushButton#secondary { background-color: #2d3748; }
QPushButton#secondary:hover { background-color: #4a5568; }
QPushButton#success { background-color: #276749; }
QPushButton#success:hover { background-color: #2f855a; }
QLineEdit, QComboBox, QDoubleSpinBox, QListWidget, QSlider {
    background-color: #1e222c; border: 1px solid #3a3f4b;
    border-radius: 6px; padding: 6px;
}
QGroupBox {
    border: 1px solid #3a3f4b; border-radius: 8px;
    margin-top: 12px; padding-top: 12px; font-weight: bold;
}
QGroupBox::title { subcontrol-origin: margin; left: 10px; color: #63b3ed; }
QListWidget::item { padding: 6px; }
QListWidget::item:selected { background-color: #2b6cb0; }
QProgressBar {
    background-color: #1e222c; border: 1px solid #3a3f4b;
    border-radius: 6px; text-align: center;
}
QProgressBar::chunk { background-color: #2b6cb0; border-radius: 6px; }
QLabel#heading { font-size: 18px; font-weight: bold; }
QLabel#info { color: #a0aec0; }
"""

VIDEO_FILTER = "ভিডিও (*.mp4 *.mov *.mkv *.avi *.webm *.m4v);;সব ফাইল (*)"


class _JobBridge(QObject):
    """Thread-safe bridge: worker thread -> GUI thread."""
    done = Signal(str, str)   # (message, output_path)
    failed = Signal(str)      # error message


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle(APP_TITLE)
        self.setMinimumSize(620, 780)

        self.save_dir = DEFAULT_DIR
        self.save_dir.mkdir(parents=True, exist_ok=True)
        self.current_video: str = ""
        self.merge_clips: list[str] = []
        self._busy = False

        self._bridge = _JobBridge()
        self._bridge.done.connect(self._on_job_done)
        self._bridge.failed.connect(self._on_job_failed)

        self._build_ui()
        self.setStatusBar(QStatusBar(self))
        self.statusBar().showMessage("প্রস্তুত — Ready")

    # -- UI ----------------------------------------------------------------
    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(10)

        title = QLabel("👻 Ghost Video Editor Bangla")
        title.setObjectName("heading")
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)

        sub = QLabel("ট্রিম • স্প্লিট • মার্জ • টেক্সট • ফিল্টার • গতি — প্রফেশনাল এডিটর")
        sub.setAlignment(Qt.AlignCenter)
        layout.addWidget(sub)

        # Pick video
        pick_row = QHBoxLayout()
        self.video_label = QLabel("কোনো ভিডিও বাছাই করা হয়নি")
        self.video_label.setObjectName("info")
        self.video_label.setWordWrap(True)
        pick_row.addWidget(self.video_label, stretch=1)
        pick_btn = QPushButton("📂 ভিডিও বাছুন")
        pick_btn.clicked.connect(self._pick_video)
        pick_row.addWidget(pick_btn)
        layout.addLayout(pick_row)

        self.info_label = QLabel("")
        self.info_label.setObjectName("info")
        layout.addWidget(self.info_label)

        # Trim
        trim_box = QGroupBox("✂️ ট্রিম (Trim) — শুরু ও শেষ সময় (সেকেন্ড)")
        trim_layout = QHBoxLayout(trim_box)
        self.trim_start = QDoubleSpinBox()
        self.trim_start.setRange(0, 100000)
        self.trim_start.setDecimals(2)
        self.trim_start.setPrefix("শুরু: ")
        self.trim_start.setSuffix(" s")
        self.trim_end = QDoubleSpinBox()
        self.trim_end.setRange(0, 100000)
        self.trim_end.setDecimals(2)
        self.trim_end.setPrefix("শেষ: ")
        self.trim_end.setSuffix(" s")
        trim_layout.addWidget(self.trim_start)
        trim_layout.addWidget(self.trim_end)
        trim_btn = QPushButton("ট্রিম করুন")
        trim_btn.clicked.connect(self._do_trim)
        trim_layout.addWidget(trim_btn)
        layout.addWidget(trim_box)

        # Split
        split_box = QGroupBox("🔪 স্প্লিট (Split) — কোন সময়ে ভাগ করবেন?")
        split_layout = QHBoxLayout(split_box)
        self.split_at = QDoubleSpinBox()
        self.split_at.setRange(0, 100000)
        self.split_at.setDecimals(2)
        self.split_at.setPrefix("সময়: ")
        self.split_at.setSuffix(" s")
        split_layout.addWidget(self.split_at)
        split_btn = QPushButton("ভাগ করুন")
        split_btn.clicked.connect(self._do_split)
        split_layout.addWidget(split_btn)
        layout.addWidget(split_box)

        # Merge
        merge_box = QGroupBox("🔗 মার্জ (Merge) — একাধিক ক্লিপ জোড়া দিন")
        merge_layout = QVBoxLayout(merge_box)
        self.merge_list = QListWidget()
        self.merge_list.setMaximumHeight(90)
        merge_layout.addWidget(self.merge_list)
        merge_btns = QHBoxLayout()
        add_clip_btn = QPushButton("＋ ক্লিপ যোগ করুন")
        add_clip_btn.setObjectName("secondary")
        add_clip_btn.clicked.connect(self._add_merge_clip)
        merge_btns.addWidget(add_clip_btn)
        remove_clip_btn = QPushButton("− সরান")
        remove_clip_btn.setObjectName("secondary")
        remove_clip_btn.clicked.connect(self._remove_merge_clip)
        merge_btns.addWidget(remove_clip_btn)
        merge_run_btn = QPushButton("মার্জ করুন")
        merge_run_btn.clicked.connect(self._do_merge)
        merge_btns.addWidget(merge_run_btn)
        merge_layout.addLayout(merge_btns)
        layout.addWidget(merge_box)

        # Text overlay
        text_box = QGroupBox("🔤 টেক্সট (Text Overlay)")
        text_layout = QHBoxLayout(text_box)
        self.text_input = QLineEdit()
        self.text_input.setPlaceholderText("টেক্সট লিখুন… যেমন: শুভ নববর্ষ")
        text_layout.addWidget(self.text_input, stretch=2)
        self.text_pos = QComboBox()
        self.text_pos.addItems(["নিচে (bottom)", "মাঝে (center)", "উপরে (top)"])
        text_layout.addWidget(self.text_pos)
        self.text_size = QDoubleSpinBox()
        self.text_size.setRange(16, 200)
        self.text_size.setValue(48)
        self.text_size.setPrefix("আকার: ")
        text_layout.addWidget(self.text_size)
        text_btn = QPushButton("টেক্সট যোগ করুন")
        text_btn.clicked.connect(self._do_add_text)
        text_layout.addWidget(text_btn)
        layout.addWidget(text_box)

        # Filters
        filter_box = QGroupBox("🎨 ফিল্টার — উজ্জ্বলতা ও কনট্রাস্ট")
        filter_layout = QVBoxLayout(filter_box)
        bright_row = QHBoxLayout()
        bright_row.addWidget(QLabel("উজ্জ্বলতা:"))
        self.bright_slider = QSlider(Qt.Horizontal)
        self.bright_slider.setRange(-100, 100)
        self.bright_slider.setValue(0)
        self.bright_slider.valueChanged.connect(self._update_filter_labels)
        bright_row.addWidget(self.bright_slider, stretch=1)
        self.bright_label = QLabel("0.00")
        bright_row.addWidget(self.bright_label)
        filter_layout.addLayout(bright_row)
        contrast_row = QHBoxLayout()
        contrast_row.addWidget(QLabel("কনট্রাস্ট:"))
        self.contrast_slider = QSlider(Qt.Horizontal)
        self.contrast_slider.setRange(0, 200)
        self.contrast_slider.setValue(100)
        self.contrast_slider.valueChanged.connect(self._update_filter_labels)
        contrast_row.addWidget(self.contrast_slider, stretch=1)
        self.contrast_label = QLabel("1.00")
        contrast_row.addWidget(self.contrast_label)
        filter_layout.addLayout(contrast_row)
        filter_btn = QPushButton("ফিল্টার প্রয়োগ করুন")
        filter_btn.clicked.connect(self._do_filter)
        filter_layout.addWidget(filter_btn)
        layout.addWidget(filter_box)

        # Speed
        speed_box = QGroupBox("⏩ গতি (Speed)")
        speed_layout = QHBoxLayout(speed_box)
        self.speed_combo = QComboBox()
        self.speed_combo.addItems(["0.5× (ধীর)", "1.0× (সাধারণ)", "1.5×", "2.0× (দ্রুত)"])
        self.speed_combo.setCurrentIndex(1)
        speed_layout.addWidget(self.speed_combo, stretch=1)
        speed_btn = QPushButton("গতি বদলান")
        speed_btn.clicked.connect(self._do_speed)
        speed_layout.addWidget(speed_btn)
        layout.addWidget(speed_box)

        # Export + progress
        export_btn = QPushButton("⬇️ MP4 এক্সপোর্ট করুন")
        export_btn.setObjectName("success")
        export_btn.clicked.connect(self._do_export)
        layout.addWidget(export_btn)

        self.progress = QProgressBar()
        self.progress.setRange(0, 0)  # indeterminate while busy
        self.progress.setVisible(False)
        layout.addWidget(self.progress)

        # History
        layout.addWidget(QLabel("ইতিহাস — History (খুলতে ডাবল ক্লিক করুন):"))
        self.history = QListWidget()
        self.history.itemDoubleClicked.connect(self._open_history_item)
        layout.addWidget(self.history, stretch=1)

    # -- helpers -----------------------------------------------------------
    def _show_error(self, title: str, message: str) -> None:
        QMessageBox.warning(self, title, message)
        self.statusBar().showMessage(f"ত্রুটি: {message.splitlines()[0]}")

    def _need_video(self) -> bool:
        if not self.current_video:
            self._show_error("ভিডিও নেই", "আগে একটি ভিডিও বাছুন।\nPlease pick a video first.")
            return False
        return True

    def _ask_output(self, default_name: str) -> str:
        path, _ = QFileDialog.getSaveFileName(
            self, "সংরক্ষণ করুন", str(self.save_dir / default_name),
            "MP4 ভিডিও (*.mp4)")
        return path

    def _default_name(self, suffix: str) -> str:
        stem = Path(self.current_video).stem if self.current_video else "video"
        return f"{stem}-{suffix}.mp4"

    def _add_to_history(self, path: str) -> None:
        item = QListWidgetItem(f"{Path(path).name}  —  {path}")
        item.setData(Qt.UserRole, path)
        self.history.insertItem(0, item)

    def _open_history_item(self, item: QListWidgetItem) -> None:
        path = item.data(Qt.UserRole)
        if not path:
            return
        if not Path(path).exists():
            QMessageBox.warning(self, "পাওয়া যায়নি", f"ফাইল নেই:\n{path}")
            return
        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QDesktopServices
        QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    def _set_busy(self, busy: bool, message: str = "") -> None:
        self._busy = busy
        self.progress.setVisible(busy)
        if message:
            self.statusBar().showMessage(message)

    def _run_job(self, message: str, func) -> None:
        """Run an editor function in a worker thread; report via bridge."""
        if self._busy:
            QMessageBox.information(self, "ব্যস্ত", "একটি কাজ চলছে — শেষ হলে আবার চেষ্টা করুন।")
            return
        self._set_busy(True, message)

        def worker() -> None:
            try:
                out = func()
                paths = out if isinstance(out, (list, tuple)) else [out]
                self._bridge.done.emit(
                    f"✅ সংরক্ষিত: {', '.join(paths)}", paths[0])
                for extra in paths[1:]:
                    self._bridge.done.emit(f"✅ সংরক্ষিত: {extra}", extra)
            except EditorError as exc:
                self._bridge.failed.emit(str(exc))
            except Exception as exc:  # noqa: BLE001
                self._bridge.failed.emit(f"অপ্রত্যাশিত ত্রুটি: {exc}")

        threading.Thread(target=worker, name="ghost-editor-job", daemon=True).start()

    def _on_job_done(self, message: str, out_path: str) -> None:
        self._set_busy(False)
        self._add_to_history(out_path)
        self.statusBar().showMessage(message)

    def _on_job_failed(self, message: str) -> None:
        self._set_busy(False)
        self._show_error("কাজটি হয়নি", message)

    def _update_filter_labels(self) -> None:
        self.bright_label.setText(f"{self.bright_slider.value() / 100:.2f}")
        self.contrast_label.setText(f"{self.contrast_slider.value() / 100:.2f}")

    # -- slots -------------------------------------------------------------
    def _pick_video(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "ভিডিও বাছুন", "", VIDEO_FILTER)
        if not path:
            return
        try:
            info = probe(path)
        except EditorError as exc:
            self._show_error("ভিডিও খোলা যায়নি", str(exc))
            return
        self.current_video = path
        self.video_label.setText(f"🎬 {Path(path).name}")
        self.info_label.setText(
            f"দৈর্ঘ্য: {info['duration']:.2f} সেকেন্ড • "
            f"রেজোলিউশন: {info['width']}×{info['height']} • "
            f"FPS: {info['fps']:.1f} • "
            f"অডিও: {'আছে' if info['has_audio'] else 'নেই'}"
        )
        self.trim_end.setValue(info["duration"])
        self.split_at.setValue(info["duration"] / 2)
        self.statusBar().showMessage(f"ভিডিও বাছাই হয়েছে: {path}")

    def _do_trim(self) -> None:
        if not self._need_video():
            return
        start, end = self.trim_start.value(), self.trim_end.value()
        out = self._ask_output(self._default_name("trim"))
        if not out:
            return
        self._run_job("✂️ ট্রিম হচ্ছে…", lambda: trim(self.current_video, out, start, end))

    def _do_split(self) -> None:
        if not self._need_video():
            return
        at = self.split_at.value()
        base = Path(self.current_video).stem
        out1, _ = QFileDialog.getSaveFileName(
            self, "প্রথম অংশ সংরক্ষণ করুন",
            str(self.save_dir / f"{base}-part1.mp4"), "MP4 ভিডিও (*.mp4)")
        if not out1:
            return
        out2, _ = QFileDialog.getSaveFileName(
            self, "দ্বিতীয় অংশ সংরক্ষণ করুন",
            str(self.save_dir / f"{base}-part2.mp4"), "MP4 ভিডিও (*.mp4)")
        if not out2:
            return
        self._run_job("🔪 ভাগ করা হচ্ছে…",
                      lambda: split(self.current_video, out1, out2, at))

    def _do_add_text(self) -> None:
        if not self._need_video():
            return
        text = self.text_input.text().strip()
        if not text:
            self._show_error("টেক্সট নেই", "আগে টেক্সট লিখুন।\nPlease type some text first.")
            return
        position = ["bottom", "center", "top"][self.text_pos.currentIndex()]
        size = int(self.text_size.value())
        out = self._ask_output(self._default_name("text"))
        if not out:
            return
        self._run_job("🔤 টেক্সট যোগ করা হচ্ছে…",
                      lambda: add_text(self.current_video, out, text, position, size))

    def _do_filter(self) -> None:
        if not self._need_video():
            return
        brightness = self.bright_slider.value() / 100
        contrast = self.contrast_slider.value() / 100
        out = self._ask_output(self._default_name("filter"))
        if not out:
            return
        self._run_job("🎨 ফিল্টার প্রয়োগ হচ্ছে…",
                      lambda: apply_filter(self.current_video, out, brightness, contrast))

    def _do_speed(self) -> None:
        if not self._need_video():
            return
        factor = [0.5, 1.0, 1.5, 2.0][self.speed_combo.currentIndex()]
        out = self._ask_output(self._default_name(f"speed{factor}x"))
        if not out:
            return
        self._run_job("⏩ গতি বদলানো হচ্ছে…",
                      lambda: change_speed(self.current_video, out, factor))

    def _do_export(self) -> None:
        if not self._need_video():
            return
        out = self._ask_output(self._default_name("export"))
        if not out:
            return
        self._run_job("⬇️ এক্সপোর্ট হচ্ছে…",
                      lambda: export_mp4(self.current_video, out))

    def _add_merge_clip(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(self, "ক্লিপ বাছুন", "", VIDEO_FILTER)
        for path in paths:
            if path not in self.merge_clips:
                self.merge_clips.append(path)
                self.merge_list.addItem(QListWidgetItem(path))
        if paths:
            self.statusBar().showMessage(f"{len(self.merge_clips)}টি ক্লিপ — মার্জের জন্য প্রস্তুত")

    def _remove_merge_clip(self) -> None:
        row = self.merge_list.currentRow()
        if row < 0:
            return
        self.merge_list.takeItem(row)
        del self.merge_clips[row]

    def _do_merge(self) -> None:
        if len(self.merge_clips) < 2:
            self._show_error("ক্লিপ কম", "মার্জ করতে অন্তত ২টি ক্লিপ যোগ করুন।\nAdd at least 2 clips to merge.")
            return
        out = self._ask_output("merged.mp4")
        if not out:
            return
        clips = list(self.merge_clips)
        self._run_job("🔗 মার্জ হচ্ছে…", lambda: merge(clips, out))


def main() -> int:
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_STYLE)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
