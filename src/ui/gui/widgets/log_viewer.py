"""GUI log viewer (refactored for clarity).

Features:
- In-app Treeview showing log records (time, level, logger, message).
- Persistent in-memory buffer so logs survive close/open of the viewer.
- Duplicate-collapse: rapid identical messages are merged with a repeat count.
- Session/banner detection and special styling.
- SCRAPE and SUCCESS tags with custom colors.
- Redirects stdout/stderr to the app logger while open but prevents recursion
  by temporarily rebinding console StreamHandlers to the real stdout/stderr.
"""

import logging
import os
import sys
import time
import re
import tkinter as tk
from tkinter import ttk, filedialog
import customtkinter as ctk


class LogViewer:
    INLINE_NEWLINE_MARKER = " ⤶ "

    def __init__(self, app):
        self.app = app
        self.root = app.app
        self.logger_obj = getattr(app.logger, 'logger', logging.getLogger())

        # UI state
        self.window = None
        self.tree = None

        # Handler and stream redirection state
        self._handler = None
        self._orig_stdout = None
        self._orig_stderr = None
        self._modified_handler_streams = []

        # Persistent buffers
        self._buffered_entries = []
        self._buffered_iids = []
        self._full_messages = {}

    # --- Public API -------------------------------------------------
    def open(self):
        """Create (or focus) the log viewer window and attach the GUI handler."""
        if self.window and tk.Toplevel.winfo_exists(self.window):
            try:
                self.window.lift()
            except Exception:
                pass
            return

        self._create_window()

        if not self._handler:
            handler = self._create_gui_log_handler(self._append_cb)
            try:
                self.logger_obj.addHandler(handler)
                self._handler = handler
            except Exception:
                self._handler = None
        else:
            try:
                if self._handler not in self.logger_obj.handlers:
                    self.logger_obj.addHandler(self._handler)
            except Exception:
                pass
            
        if not self._buffered_entries:
            self._preload_debug_log()

        self._populate_from_buffer()
        self._redirect_streams()

    def clear(self):
        """Clear both the Treeview and the persistent buffer."""
        if self.tree:
            try:
                self.tree.delete(*self.tree.get_children())
            except Exception:
                pass
        self._full_messages.clear()
        self._buffered_entries.clear()
        self._buffered_iids.clear()

        try:
            path = getattr(getattr(self.app, 'logger', None), 'log_file_path', None) or os.path.join(os.getcwd(), getattr(getattr(self.app, 'config', None), 'log_file', 'debug.log'))
            if os.path.exists(path):
                open(path, 'w', encoding='utf-8').close()
        except Exception:
            pass

    def save_to_file(self):
        path = filedialog.asksaveasfilename(defaultextension='.log', filetypes=[('Log files', '*.log'), ('Text files', '*.txt'), ('All files','*.*')])
        if not path:
            return
        src = None
        try:
            src = getattr(self.app.logger, 'log_file_path', None)
        except Exception:
            src = None
        if not src:
            src = os.path.join(os.getcwd(), 'debug.log')

        try:
            with open(src, 'r', encoding='utf-8') as inf, open(path, 'w', encoding='utf-8') as outf:
                for line in inf:
                    outf.write(line)
        except Exception:
            try:
                with open(path, 'w', encoding='utf-8') as fh:
                    for iid in (self.tree.get_children() if self.tree else []):
                        vals = self.tree.item(iid, 'values')
                        full = self._full_messages.get(iid)
                        if full:
                            fh.write(full + os.linesep)
                        else:
                            fh.write(' | '.join([str(v) for v in vals]) + os.linesep)
            except Exception:
                pass

    def close(self):
        """Close the window and restore original stdout/stderr and handler streams."""
        try:
            if self._orig_stdout is not None:
                sys.stdout = self._orig_stdout
            if self._orig_stderr is not None:
                sys.stderr = self._orig_stderr
        except Exception:
            pass

        try:
            for h, old_stream in getattr(self, '_modified_handler_streams', []):
                try:
                    h.stream = old_stream
                except Exception:
                    pass
        except Exception:
            pass

        if self.window:
            try:
                self.window.destroy()
            except Exception:
                pass

        self.window = None
        self.tree = None
        self._orig_stdout = None
        self._orig_stderr = None

    # --- Internal helpers -------------------------------------------
    def _create_window(self):
        self.window = ctk.CTkToplevel(self.root)
        self.window.title("Debug / Log Viewer")
        self.window.geometry("1000x480")
        self.window.configure(fg_color="#2A2B2B")
        self.window.protocol("WM_DELETE_WINDOW", self.close)

        frame = tk.Frame(self.window, bg="#2A2B2B")
        frame.pack(fill="both", expand=True, padx=8, pady=8)

        style = ttk.Style()
        try:
            style.theme_use('clam')
        except Exception:
            pass
        style.configure('Log.Treeview', background='#1C1E1E', fieldbackground='#1C1E1E', foreground='#CECECE')

        columns = ('time', 'level', 'message', 'loc')
        tree = ttk.Treeview(frame, columns=columns, show='headings', style='Log.Treeview')

        for col, width, txt in (('time', 110, 'Time'), ('level', 100, 'Level'), ('message', 600, 'Message'), ('loc', 120, 'Location')):
            tree.heading(col, text=txt)
            tree.column(col, width=width, anchor='w', stretch=(col == 'message'))

        vsb = ttk.Scrollbar(frame, orient='vertical', command=tree.yview)
        hsb = ttk.Scrollbar(frame, orient='horizontal', command=tree.xview)
        tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)
        hsb.pack(side=tk.BOTTOM, fill=tk.X)
        tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # tags and colors
        tree.tag_configure('ERROR', background='#330a0a', foreground='#FF6B6B')
        tree.tag_configure('WARNING', background='#3b2200', foreground='#FFD27A')
        tree.tag_configure('INFO', background='#121212', foreground='#E6E6E6')
        tree.tag_configure('DEBUG', background='#0f1112', foreground='#9FB0C6')
        tree.tag_configure('SESSION', background='#2a0a20', foreground='#FF9AD1')
        tree.tag_configure('SUCCESS', background='#0a3d12', foreground='#9CFF9C')
        tree.tag_configure('SCRAPE', background='#06273f', foreground='#D6F6FF')

        tree.bind('<Double-1>', self._on_double_click)

        ctrl = tk.Frame(self.window, bg="#2A2B2B")
        ctrl.pack(fill='x', padx=8, pady=(0,8))
        clear_btn = self.app.ui_helpers.create_button(ctrl, text="Clear", command=self.clear)
        clear_btn.pack(side='left', padx=(0,6))
        save_btn = self.app.ui_helpers.create_button(ctrl, text="Save...", command=self.save_to_file)
        save_btn.pack(side='left', padx=(0,6))
        close_btn = self.app.ui_helpers.create_button(ctrl, text="Close", command=self.close)
        close_btn.pack(side='right')

        self.tree = tree

    def _preload_debug_log(self, path=None, max_lines=1000):
        if path is None:
            path = os.path.join(os.getcwd(), 'debug.log')
        if not os.path.exists(path):
            return
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                lines = fh.readlines()[-max_lines:]
            for ln in lines:
                parts = [p.strip() for p in ln.split('|')]
                if len(parts) >= 4:
                    t = parts[0]
                    lvl = parts[1].split()[0]
                    raw_msg = ' | '.join(parts[3:]).strip()
                    loc = ''
                    msg = raw_msg
                    if '|' in raw_msg:
                        left, right = [p.strip() for p in raw_msg.split('|', 1)]
                        if re.search(r':\d+$', left) and left.split(':', 1)[0].lower() not in ('info', 'debug', 'warning', 'error', 'critical'):
                            loc = left
                            msg = right
                    self._buffered_entries.append((0.0, t, lvl, loc, msg, 1))
        except Exception:
            pass

    def _populate_from_buffer(self):
        """Insert buffered entries into the Treeview (called on open)."""
        self._full_messages = {}
        for entry in self._buffered_entries:
            try:
                _, time_str, level, loc, original, _ = entry
            except Exception:
                continue

            msg = original.replace('\r\n', '\n').replace('\r', '\n')
            if '\n' in msg:
                msg = msg.replace('\n', self.INLINE_NEWLINE_MARKER)

            tag = (level or 'INFO').upper()
            lower_msg = (msg or '').lower()
            if re.match(r'^[=\-\s]{5,}$', msg.strip()):
                continue
            if 'new session started' in lower_msg:
                tag = 'SESSION'
            if any(k in lower_msg for k in ("signed in with plex", "token populated", "received auth token", "saving configuration", "configuration saved", "uploaded", "processed", "successfully", "completed upload")):
                tag = 'SUCCESS'
            if 'scrap' in lower_msg or 'scraping' in lower_msg:
                tag = 'SCRAPE'

            display_level = level
            if tag == 'SUCCESS':
                display_level = 'SUCCESS'
            elif tag == 'SCRAPE':
                display_level = 'SCRAPE'

            try:
                full_original = (loc + ' | ' + original) if loc else original
                iid = self.tree.insert('', tk.END, values=(time_str, display_level, msg, loc), tags=(tag,))
                self._full_messages[iid] = full_original
                self._buffered_iids.append(iid)
            except Exception:
                pass
        try:
            children = self.tree.get_children()
            if children:
                self.tree.see(children[-1])
        except Exception:
            pass

    def _create_gui_log_handler(self, cb):
        class GuiLogHandler(logging.Handler):
            def __init__(self, callback):
                super().__init__()
                self.cb = callback

            def emit(self, record):
                try:
                    time_str = self.formatter.formatTime(record, datefmt='%H:%M:%S') if hasattr(self, 'formatter') else ''
                    level = record.levelname
                    msg = record.getMessage()
                    try:
                        loc = f"{record.filename}:{record.funcName}:{record.lineno}"
                    except Exception:
                        try:
                            loc = f"{record.module}:{record.lineno}"
                        except Exception:
                            loc = ''

                    try:
                        if '|' in msg:
                            left, right = [p.strip() for p in msg.split('|', 1)]
                            if re.search(r"^[\w\.\-]+:\d+$", left) and left.split(':', 1)[0].lower() not in ('info', 'debug', 'warning', 'error', 'critical'):
                                loc = left
                                msg = right
                    except Exception:
                        pass

                    self.cb((time_str, level, loc, msg))
                except Exception:
                    pass

        handler = GuiLogHandler(cb)
        handler.setLevel(logging.DEBUG)
        fmt = logging.Formatter('%(asctime)s | %(levelname)-7s | %(name)s | %(message)s', datefmt='%H:%M:%S')
        handler.setFormatter(fmt)
        return handler

    def _append_cb(self, data):
        try:
            self.root.after(0, lambda: self.append(data))
        except Exception:
            try:
                self.append(data)
            except Exception:
                pass

    # --- append logic ------------------------------------------------
    def append(self, data):
        """Append a log record (structured tuple or string). Handles buffering,
        duplicate-collapse, and Treeview insertion when visible."""
        if not (isinstance(data, (list, tuple)) and len(data) >= 4):
            return
        time_str, level, loc, message = data[0], data[1], data[2], data[3]

        original = message

        try:
            for prefix in ('INFO:', 'ERROR:', 'WARNING:', 'DEBUG:'):
                if message.count(prefix) > 3:
                    last_idx = message.rfind(prefix)
                    message = message[last_idx:]
                    break
        except Exception:
            pass

        try:
            ts = time.time()
            max_rows = 20000

            if self._buffered_entries:
                last = self._buffered_entries[-1]
                try:
                    last_ts, _, last_level, last_loc, last_orig, last_count = last
                except Exception:
                    last_ts = 0
                    last_level = last[2] if len(last) > 2 else ''
                    last_loc = last[3] if len(last) > 3 else ''
                    last_orig = last[4] if len(last) > 4 else ''
                    last_count = 1

                if (last_level == level and last_loc == loc and last_orig == original and (ts - (last_ts or 0.0)) < 2.0):
                    try:
                        self._buffered_entries[-1] = (last_ts, last[1], last_level, last_loc, last_orig, last_count + 1)
                    except Exception:
                        pass

                    try:
                        if self.tree and self._buffered_iids:
                            last_iid = self._buffered_iids[-1]
                            vals = list(self.tree.item(last_iid, 'values'))
                            cur_msg = vals[2]
                            cur_msg = re.sub(r"\s\(x\d+\)$", '', cur_msg)
                            new_msg = cur_msg + f" (x{last_count + 1})"
                            vals[2] = new_msg
                            self.tree.item(last_iid, values=vals)
                            self._full_messages[last_iid] = last_orig
                    except Exception:
                        pass

                    try:
                        if len(self._buffered_entries) > max_rows:
                            self._buffered_entries = self._buffered_entries[-max_rows:]
                            self._buffered_iids = self._buffered_iids[-max_rows:]
                    except Exception:
                        pass
                    return

            try:
                self._buffered_entries.append((ts, time_str, level, loc, original, 1))
                if len(self._buffered_entries) > max_rows:
                    self._buffered_entries = self._buffered_entries[-max_rows:]
            except Exception:
                pass
        except Exception:
            pass

        if not self.tree:
            return

        try:
            message = message.replace('\r\n', '\n').replace('\r', '\n')
            if '\n' in message:
                message = message.replace('\n', self.INLINE_NEWLINE_MARKER)
        except Exception:
            pass

        tag = (level or 'INFO').upper()
        lower_msg = (message or '').lower()
        
        if re.match(r'^[=\-\s]{5,}$', message.strip()):
            return
        if 'new session started' in lower_msg:
            tag = 'SESSION'

        if any(k in lower_msg for k in ("signed in with plex", "token populated", "received auth token", "saving configuration", "configuration saved", "uploaded", "processed", "successfully", "completed upload")):
            tag = 'SUCCESS'
        if 'scrap' in lower_msg or 'scraping' in lower_msg:
            tag = 'SCRAPE'

        display_level = level
        if tag == 'SUCCESS':
            display_level = 'SUCCESS'
        elif tag == 'SCRAPE':
            display_level = 'SCRAPE'

        try:
            iid = self.tree.insert('', tk.END, values=(time_str, display_level, message, loc), tags=(tag,))
            full_original = (loc + ' | ' + original) if loc else original
            self._full_messages[iid] = full_original
            self._buffered_iids.append(iid)

            children = self.tree.get_children()
            if children:
                self.tree.see(children[-1])
        except Exception:
            pass
        
        try:
            max_rows = 20000
            if self.tree and len(self.tree.get_children()) > max_rows:
                for iid in self.tree.get_children()[:len(self.tree.get_children()) - max_rows]:
                    try:
                        self.tree.delete(iid)
                        self._full_messages.pop(iid, None)
                    except Exception:
                        pass
            if len(self._buffered_entries) > max_rows:
                self._buffered_entries = self._buffered_entries[-max_rows:]
            if len(self._buffered_iids) > max_rows:
                self._buffered_iids = self._buffered_iids[-max_rows:]
        except Exception:
            pass

    # --- stream redirection helpers ---------------------------------
    def _redirect_streams(self):
        class StreamToLogger:
            def __init__(self, logger_obj, level=logging.INFO):
                self.logger_obj = logger_obj
                self.level = level

            def write(self, buf):
                try:
                    clean = re.sub(r'^(?:[A-Z]+:\s+)+', '', buf)
                except Exception:
                    clean = buf
                for line in clean.rstrip().splitlines():
                    if not line:
                        continue
                    try:
                        self.logger_obj.log(self.level, line)
                    except Exception:
                        pass

            def flush(self):
                pass

        try:
            self._orig_stdout = sys.stdout
            self._orig_stderr = sys.stderr

            try:
                self._modified_handler_streams = []
                for h in getattr(self.logger_obj, 'handlers', []):
                    try:
                        if isinstance(h, logging.StreamHandler):
                            s = getattr(h, 'stream', None)
                            if s is sys.stdout:
                                self._modified_handler_streams.append((h, s))
                                h.stream = self._orig_stdout
                            elif s is sys.stderr:
                                self._modified_handler_streams.append((h, s))
                                h.stream = self._orig_stderr
                    except Exception:
                        pass
            except Exception:
                pass

            sys.stdout = StreamToLogger(self.logger_obj, logging.INFO)
            sys.stderr = StreamToLogger(self.logger_obj, logging.ERROR)
        except Exception:
            pass

    # --- interaction helpers ----------------------------------------
    def _on_double_click(self, event):
        try:
            sel = event.widget.selection()
            if not sel:
                return
            iid = sel[0]
            vals = event.widget.item(iid, 'values')
            full = self._full_messages.get(iid, ' | '.join([str(v) for v in vals]))
            self._show_modal(full)
        except Exception:
            pass

    def _show_modal(self, message):
        try:
            m = ctk.CTkToplevel(self.window or self.root)
            m.geometry('640x360')
            m.title('Log Message')
            txt = tk.Text(m, wrap='word')
            txt.insert('1.0', message)
            txt.pack(fill='both', expand=True, padx=8, pady=8)

            def _copy():
                try:
                    m.clipboard_clear()
                    m.clipboard_append(message)
                except Exception:
                    pass

            btn = self.app.ui_helpers.create_button(m, text='Copy', command=_copy)
            btn.pack(pady=(0,8))
        except Exception:
            pass

