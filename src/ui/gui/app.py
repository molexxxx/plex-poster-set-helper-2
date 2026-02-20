"""Main GUI application for Plex Poster Set Helper - Refactored Architecture."""

import os
import sys
import threading
import webbrowser
import logging
import tkinter as tk
from tkinter import ttk
import time
import customtkinter as ctk
import re
from PIL import Image
from typing import List

from ...core.config import ConfigManager, Config
from ...core.logger import get_logger
from ...services.plex_service import PlexService
from ...services.poster_upload_service import PosterUploadService
from ...scrapers.scraper_factory import ScraperFactory
from ...utils.helpers import resource_path, get_exe_dir
from ...utils.text_utils import parse_urls

from .widgets import UIHelpers
from .widgets.log_viewer import LogViewer
from .handlers import ScrapeHandler, LabelHandler
from .tabs import (
    PosterScrapeTab,
    BulkImportTab,
    TitleMappingsTab,
    ManageLabelsTab,
    SettingsTab
)


class PlexPosterGUI:
    """Main GUI application with modular architecture."""
    
    def __init__(self):
        """Initialize the GUI application."""
        self.config_manager = ConfigManager()
        self.config = self.config_manager.load()
        
        # Initialize logger
        self.logger = get_logger()
        # Pass append/write preference from config when configuring logger
        try:
            append_mode = bool(getattr(self.config, 'log_append', False))
        except Exception:
            append_mode = False
        self.logger.configure(log_file=self.config.log_file, append=append_mode)
        self.logger.info("GUI Application initializing...")
        
        # Services
        self.plex_service: PlexService = None
        self.upload_service: PosterUploadService = None
        self.scraper_factory: ScraperFactory = None
        
        # Main window
        self.app = None
        
        # Status and progress
        self.status_label = None
        self.progress_bar = None
        self.progress_label = None
        self.cancel_button = None
        self.is_cancelled = False
        
        # Bulk import state
        self.current_bulk_file = None
        
        # Helpers and handlers (initialized after UI creation)
        self.ui_helpers = None
        self.scrape_handler = None
        self.label_handler = None
        
        # Tab instances
        self.poster_scrape_tab = None
        self.bulk_import_tab = None
        self.title_mappings_tab = None
        self.manage_labels_tab = None
        self.settings_tab = None
        
        # Expose settings tab variables for backwards compatibility
        self.base_url_entry = None
        self.token_entry = None
        self.max_workers_var = None
        self.initial_delay_var = None
        self.min_delay_var = None
        self.max_delay_var = None
        self.batch_delay_var = None
        self.page_wait_min_var = None
        self.page_wait_max_var = None
        
        # Expose manage labels variables for backwards compatibility
        self.labeled_items_scroll = None
        self.labeled_count_label = None
        self.labeled_library_label = None
        self.labeled_source_label = None
        self.labeled_search_var = None
        self.labeled_filter_mediux = None
        self.labeled_filter_posterdb = None
        self.labeled_filter_movies = None
        self.labeled_filter_tv = None
        # Log window and handler
        self.log_window = None
        self._gui_log_handler = None
        self.log_text_widget = None
        # Mapping of Treeview item id -> full original message (for modal/save)
        self._log_full_messages = {}
    
    def run(self):
        """Run the GUI application."""
        self._create_ui()
        self.app.mainloop()
    
    def _create_ui(self):
        """Create the main UI window."""
        self.app = ctk.CTk()
        ctk.set_appearance_mode("dark")
        
        self.app.title("Plex Poster Upload Helper")
        self.app.geometry("660x815")
        
        try:
            self.app.iconbitmap(resource_path("icons/Plex.ico"))
        except:
            pass
        
        self.app.configure(fg_color="#2A2B2B")
        self.app.protocol("WM_DELETE_WINDOW", self._on_closing)
        
        # Initialize helpers
        self.ui_helpers = UIHelpers(self.app)
        
        # Initialize handlers (before tabs, since tabs use them)
        self.scrape_handler = ScrapeHandler(self)
        self.label_handler = LabelHandler(self)
        
        # Create UI components
        self._create_link_bar()
        self._create_tabview()
        self._create_status_bar()
        
        # Load configuration into UI
        self._load_and_update_ui()
    
    def _create_link_bar(self):
        """Create the link bar at the top."""
        link_bar = ctk.CTkFrame(self.app, fg_color="transparent")
        link_bar.pack(fill="x", pady=5, padx=10)
        
        base_url = self.config.base_url if self.config.base_url else "https://www.plex.tv"
        
        try:
            from urllib.parse import urlparse
            parsed = urlparse(base_url)
            display_url = parsed.netloc if parsed.netloc else base_url
        except:
            display_url = base_url
        
        url_text = self.config.base_url if self.config.base_url else "Plex Media Server"
        url_label = ctk.CTkLabel(
            link_bar,
            text=url_text,
            anchor="w",
            font=("Roboto", 14, "bold"),
            text_color="#CECECE"
        )
        url_label.pack(side="left", padx=(5, 10))
        
        # External links
        mediux_button = self.ui_helpers.create_button(
            link_bar,
            text="MediUX.pro",
            command=lambda: webbrowser.open("https://mediux.pro"),
            color="#945af2",
            height=30
        )
        mediux_button.pack(side="right", padx=5)
        
        posterdb_button = self.ui_helpers.create_button(
            link_bar,
            text="ThePosterDB",
            command=lambda: webbrowser.open("https://theposterdb.com"),
            color="#FA6940",
            height=30
        )
        posterdb_button.pack(side="right", padx=5)

        # Logs button to open debug/status window
        logs_button = self.ui_helpers.create_button(
            link_bar,
            text="Log Viewer",
            command=self._open_log_window,
            color="#444444",
            height=30
        )
        logs_button.pack(side="right", padx=5)

    def _create_gui_log_handler(self, append_callback):
        """Create a logging.Handler that appends formatted records via append_callback."""
        class GuiLogHandler(logging.Handler):
            def __init__(self, cb):
                super().__init__()
                self.cb = cb

            def emit(self, record):
                try:
                    created = time.strftime('%H:%M:%S', time.localtime(record.created))
                    level = record.levelname
                    logger_name = record.name
                    message = record.getMessage()
                    self.cb((created, level, logger_name, message))
                except Exception:
                    pass

        handler = GuiLogHandler(append_callback)
        handler.setLevel(logging.DEBUG)
        formatter = logging.Formatter('%(asctime)s | %(levelname)-7s | %(name)s | %(message)s', datefmt='%H:%M:%S')
        handler.setFormatter(formatter)
        return handler

    def _open_log_window(self):
        """Open or focus a debug/status window and stream logs into it."""
        # Delegate whole log window to LogViewer for separation of concerns
        try:
            if not getattr(self, 'log_viewer', None):
                self.log_viewer = LogViewer(self)
            self.log_viewer.open()
        except Exception:
            pass

    def _append_log_text(self, text: str):
        """Append text to the log Text widget and scroll to end."""
        try:
            # If we have a dedicated LogViewer, delegate to it
            if getattr(self, 'log_viewer', None):
                try:
                    self.log_viewer.append(text)
                    return
                except Exception:
                    pass
            if not self.log_text_widget:
                return
            # log_text_widget is a Treeview now
            tree: ttk.Treeview = self.log_text_widget
            time, level, logger_name, message = ('', '', '', '')
            if isinstance(text, tuple) or isinstance(text, list):
                time, level, logger_name, message = text
            else:
                message = str(text)

            # keep original full message for modal/save
            original_message = message

            # Clean message and normalize fields (for display)
            time, level, logger_name, message = self._normalize_log_parts(time, level, logger_name, message)

            # Prevent multi-line rows by replacing newline characters with an inline marker
            try:
                message = str(message).replace('\r', ' ').replace('\n', ' ⤶ ')
                # collapse whitespace
                message = re.sub(r'\s+', ' ', message)
            except Exception:
                pass

            # Insert new row
            # Decide tag based on level or session
            tag = level.upper() if level else 'INFO'
            if message and ('NEW SESSION STARTED' in message.upper() or message.strip().startswith('===')):
                tag = 'SESSION'

            # Success detection -> use SUCCESS tag (green)
            lower_msg = (message or '').lower()
            if any(k in lower_msg for k in ("signed in with plex", "token populated", "received auth token", "saving configuration", "configuration saved")):
                tag = 'SUCCESS'

            iid = tree.insert('', tk.END, values=(time, level, logger_name, message), tags=(tag,))
            try:
                # store the original (unmodified) message for modal and saving
                self._log_full_messages[iid] = original_message
            except Exception:
                pass
            # Auto-scroll to end
            children = tree.get_children()
            if children:
                tree.see(children[-1])

            # Trim if too many rows
            max_rows = 20000
            cur = len(children)
            if cur > max_rows:
                # delete oldest chunk
                for iid in children[:cur - max_rows]:
                    try:
                        tree.delete(iid)
                    except Exception:
                        pass
        except Exception:
            pass

    def _toggle_handler_level(self):
        pass

    def _save_log_to_file(self, text_widget):
        """Save contents of the log text widget to a file chosen by the user."""
        try:
            # Delegate to LogViewer if available
            if getattr(self, 'log_viewer', None):
                try:
                    self.log_viewer.save_to_file()
                    return
                except Exception:
                    pass
            import tkinter.filedialog as fd
            path = fd.asksaveasfilename(defaultextension='.log', filetypes=[('Log files', '*.log'), ('All files', '*.*')])
            if not path:
                return
            # Support either Treeview or Text widget
            if isinstance(text_widget, ttk.Treeview):
                lines = []
                for iid in text_widget.get_children():
                    vals = text_widget.item(iid, 'values')
                    # prefer full original message if available
                    full_msg = self._log_full_messages.get(iid, None)
                    cols = []
                    if vals and len(vals) >= 3:
                        cols = [str(vals[0]), str(vals[1]), str(vals[2])]
                    else:
                        cols = [str(v) for v in (vals or [])]
                    # append full message last
                    cols.append(full_msg if full_msg is not None else (vals[3] if vals and len(vals) > 3 else ''))
                    lines.append(' | '.join(cols))
                with open(path, 'w', encoding='utf-8') as f:
                    f.write('\n'.join(lines))
            else:
                contents = text_widget.get('1.0', tk.END)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(contents)
            self._update_status(f"Saved log to {path}", color="#E5A00D")
        except Exception as e:
            self._update_status(f"Error saving log: {e}", color="red")

    def _append_log_row(self, data):
        """Compatibility wrapper for appending a log row into the Treeview."""
        try:
            if getattr(self, 'log_viewer', None):
                try:
                    self.log_viewer.append(data)
                    return
                except Exception:
                    pass
            self._append_log_text(data)
        except Exception:
            pass

    def _clear_log_table(self):
        """Clear the Treeview log table and associated full-message mapping."""
        try:
            if getattr(self, 'log_viewer', None):
                try:
                    self.log_viewer.clear()
                    return
                except Exception:
                    pass
            if isinstance(self.log_text_widget, ttk.Treeview):
                try:
                    self.log_text_widget.delete(*self.log_text_widget.get_children())
                except Exception:
                    pass
                try:
                    self._log_full_messages.clear()
                except Exception:
                    pass
            else:
                # Legacy Text widget clearing
                if self.log_text_widget:
                    try:
                        self.log_text_widget.configure(state=tk.NORMAL)
                        self.log_text_widget.delete('1.0', tk.END)
                        self.log_text_widget.configure(state=tk.DISABLED)
                    except Exception:
                        pass
        except Exception:
            pass

    def _normalize_log_parts(self, time_val, level, logger_name, message):
        """Clean and normalize parsed log parts for display.

        Removes repeated 'info:123|' style prefixes from messages, trims
        excess separators, and ensures level and logger are set.
        """
        try:
            # Ensure strings
            level = (level or '').strip()
            logger_name = (logger_name or '').strip()
            message = (message or '').strip()

            # Remove repeated uppercase prefixed tokens like 'INFO: INFO: ' etc.
            message = re.sub(r'^(?:\s*(?:INFO|DEBUG|ERROR|WARNING|CRITICAL)\s*:\s*)+', '', message, flags=re.IGNORECASE)

            # If message contains leading '<level>:<num>|' or 'info:123|' remove it
            message = re.sub(r'^\s*(?:debug|info|warning|error|critical)\s*:?\s*\d*\s*\|\s*', '', message, flags=re.IGNORECASE)
            # Also remove patterns like 'info:148|' or 'info|' without number
            message = re.sub(r'^\s*\w+?:\d+\|\s*', '', message)

            # Collapse repeated level prefixes anywhere in the message, e.g. 'INFO: INFO: INFO:' -> 'INFO: '
            def _collapse_prefixes(s: str) -> str:
                try:
                    pattern = re.compile(r'((?:INFO|DEBUG|ERROR|WARNING|CRITICAL)\s*:\s*){2,}', re.IGNORECASE)
                    while True:
                        m = pattern.search(s)
                        if not m:
                            break
                        first = re.match(r'^(INFO|DEBUG|ERROR|WARNING|CRITICAL)', m.group(0), re.IGNORECASE)
                        rep = (first.group(1).upper() + ': ') if first else ''
                        s = s[:m.start()] + rep + s[m.end():]
                    return s
                except Exception:
                    return s

            message = _collapse_prefixes(message)

            # Normalize level to uppercase common values
            if not level and message:
                # try to infer level from message prefix like 'DEBUG:'
                m = re.match(r'^(DEBUG|INFO|ERROR|WARNING|CRITICAL)[:\s]', message, flags=re.IGNORECASE)
                if m:
                    level = m.group(1)
                    message = re.sub(r'^(DEBUG|INFO|ERROR|WARNING|CRITICAL)[:\s]+', '', message, flags=re.IGNORECASE)

            level = (level or 'INFO').upper()

            # Special-case session banners
            if 'NEW SESSION STARTED' in message.upper() or re.match(r'^[=\-\s]{5,}$', message):
                # use a clean session message
                message = message.strip()
                logger_name = logger_name or 'Session'
                level = 'INFO'

            # Tag successful operations as SUCCESS for green highlighting
            lower_msg = message.lower()
            if any(k in lower_msg for k in ("signed in with plex", "token populated", "received auth token", "configuration saved")):
                level = 'INFO'
                # mark success via a special tag when inserting
                # We'll return level; insertion uses tag detection to set 'SUCCESS'

            return time_val, level, logger_name, message
        except Exception:
            return time_val, level or 'INFO', logger_name or '', message

    def _on_log_row_double_click(self, event):
        """Open a dialog showing the full message for the selected row."""
        try:
            if getattr(self, 'log_viewer', None):
                try:
                    return self.log_viewer._on_double_click(event)
                except Exception:
                    pass
            widget = event.widget
            selection = widget.selection()
            if not selection:
                return
            iid = selection[0]
            vals = widget.item(iid, 'values')
            if not vals or len(vals) < 4:
                return
            # Tree columns are now: time, level, message, location
            time_val, level = vals[0], vals[1]
            message_cell = vals[2]
            location_cell = vals[3] if len(vals) > 3 else ''
            # prefer original full message if we stored it
            full = self._log_full_messages.get(iid, message_cell)
            # show time | level | location in the header
            self._show_full_log_message(time_val, level, location_cell, full)
        except Exception:
            pass

    def _show_full_log_message(self, time_val, level, logger_name, message):
        """Show the full log message in a modal dialog with copy option."""
        try:
            if getattr(self, 'log_viewer', None):
                try:
                    return self.log_viewer._show_modal(message)
                except Exception:
                    pass
            dlg = ctk.CTkToplevel(self.app)
            dlg.title(f"Log Detail - {level}")
            dlg.geometry("800x400")
            dlg.configure(fg_color="#2A2B2B")

            frame = tk.Frame(dlg, bg="#2A2B2B")
            frame.pack(fill="both", expand=True, padx=8, pady=8)

            header = ctk.CTkLabel(frame, text=f"{time_val} | {level} | {logger_name}", text_color="#E5A00D")
            header.pack(fill="x", pady=(0,6))

            text = tk.Text(frame, wrap=tk.WORD, bg="#1C1E1E", fg="#CECECE", insertbackground="#E5A00D")
            text.insert('1.0', message)
            text.configure(state=tk.DISABLED)
            text.pack(fill="both", expand=True)

            btn_frame = tk.Frame(dlg, bg="#2A2B2B")
            btn_frame.pack(fill="x", pady=(6,0), padx=8)

            def copy_msg():
                try:
                    self.app.clipboard_clear()
                    self.app.clipboard_append(message)
                    self._update_status("Copied log message to clipboard", color="#E5A00D")
                except Exception:
                    pass

            copy_btn = self.ui_helpers.create_button(btn_frame, text="Copy", command=copy_msg)
            copy_btn.pack(side="left")

            close_btn = self.ui_helpers.create_button(btn_frame, text="Close", command=dlg.destroy)
            close_btn.pack(side="right")
        except Exception:
            pass

    def _close_log_window(self):
        """Close the log window and detach handler."""
        try:
            if getattr(self, 'log_viewer', None):
                try:
                    self.log_viewer.close()
                except Exception:
                    pass
                self.log_viewer = None
                return
            if self._gui_log_handler:
                try:
                    self.logger.logger.removeHandler(self._gui_log_handler)
                except Exception:
                    pass
                self._gui_log_handler = None
            if self.log_window:
                try:
                    self.log_window.destroy()
                except Exception:
                    pass
        finally:
            # Restore stdout/stderr if we redirected them when opening the viewer
            try:
                if hasattr(self, '_orig_stdout') and self._orig_stdout:
                    sys.stdout = self._orig_stdout
                    self._orig_stdout = None
                if hasattr(self, '_orig_stderr') and self._orig_stderr:
                    sys.stderr = self._orig_stderr
                    self._orig_stderr = None
            except Exception:
                pass

            self.log_window = None
            self.log_text_widget = None
            try:
                self._log_full_messages.clear()
            except Exception:
                self._log_full_messages = {}
    
    def _create_tabview(self):
        """Create the tabbed interface."""
        tabview = ctk.CTkTabview(self.app)
        tabview.pack(fill="both", expand=True, padx=10, pady=0)
        
        tabview.configure(
            fg_color="#2A2B2B",
            segmented_button_fg_color="#1C1E1E",
            segmented_button_selected_color="#2A2B2B",
            segmented_button_selected_hover_color="#2A2B2B",
            segmented_button_unselected_color="#1C1E1E",
            segmented_button_unselected_hover_color="#1C1E1E",
            text_color="#CECECE",
            text_color_disabled="#777777",
            border_color="#484848",
            border_width=1,
        )
        
        # Create all tabs
        self.poster_scrape_tab = PosterScrapeTab(tabview, self)
        self.bulk_import_tab = BulkImportTab(tabview, self)
        self.title_mappings_tab = TitleMappingsTab(tabview, self)
        self.manage_labels_tab = ManageLabelsTab(tabview, self)
        self.settings_tab = SettingsTab(tabview, self)
        
        # Set default tab
        tabview.set("Poster Scrape")
        
        # Expose settings variables
        self.base_url_entry = self.settings_tab.base_url_entry
        self.token_entry = self.settings_tab.token_entry
        self.max_workers_var = self.settings_tab.max_workers_var
        self.initial_delay_var = self.settings_tab.initial_delay_var
        self.min_delay_var = self.settings_tab.min_delay_var
        self.max_delay_var = self.settings_tab.max_delay_var
        self.batch_delay_var = self.settings_tab.batch_delay_var
        self.page_wait_min_var = self.settings_tab.page_wait_min_var
        self.page_wait_max_var = self.settings_tab.page_wait_max_var
        
        # Expose manage labels variables
        self.labeled_items_scroll = self.manage_labels_tab.scroll_frame
        self.labeled_count_label = self.manage_labels_tab.count_label
        self.labeled_library_label = self.manage_labels_tab.library_label
        self.labeled_source_label = self.manage_labels_tab.source_label
        self.labeled_search_var = self.manage_labels_tab.search_var
        self.labeled_filter_mediux = self.manage_labels_tab.filter_mediux
        self.labeled_filter_posterdb = self.manage_labels_tab.filter_posterdb
        self.labeled_filter_movies = self.manage_labels_tab.filter_movies
        self.labeled_filter_tv = self.manage_labels_tab.filter_tv
    
    def _create_status_bar(self):
        """Create status label and progress bar at bottom."""
        status_frame = ctk.CTkFrame(self.app, fg_color="transparent")
        status_frame.pack(side="bottom", fill="x", pady=5, padx=10)
        
        self.progress_bar = ctk.CTkProgressBar(
            status_frame,
            height=8,
            fg_color="#1C1E1E",
            progress_color="#E5A00D"
        )
        self.progress_bar.pack(fill="x", padx=0, pady=(0, 3))
        self.progress_bar.set(0)
        self.progress_bar.pack_forget()
        
        self.progress_label = ctk.CTkLabel(status_frame, text="", text_color="#696969", font=("Roboto", 11))
        self.progress_label.pack(fill="x", pady=(0, 2))
        self.progress_label.pack_forget()
        
        self.cancel_button = ctk.CTkButton(
            status_frame,
            text="Cancel",
            command=self._cancel_operation,
            fg_color="#8B0000",
            hover_color="#A00000",
            height=28,
            width=100
        )
        self.cancel_button.pack(pady=(0, 5))
        self.cancel_button.pack_forget()
        
        self.status_label = ctk.CTkLabel(status_frame, text="", text_color="#E5A00D", font=("Roboto", 12))
        self.status_label.pack(fill="x")
    
    def _on_closing(self):
        """Handle window close event with proper cleanup."""
        self.is_cancelled = True
        
        if self.scrape_handler:
            self.scrape_handler.cancel()
        
        if self.scraper_factory:
            try:
                self.scraper_factory.cleanup()
            except:
                pass
        
        self.app.destroy()
    
    def _load_and_update_ui(self):
        """Load configuration and update UI fields."""
        self.config = self.config_manager.load()
        
        # Load settings tab
        if self.base_url_entry:
            self.base_url_entry.delete(0, ctk.END)
            self.base_url_entry.insert(0, self.config.base_url or "")
        
        if self.token_entry:
            self.token_entry.delete(0, ctk.END)
            self.token_entry.insert(0, self.config.token or "")
        
        # Load TV libraries
        for row in self.settings_tab.tv_library_rows:
            row['frame'].destroy()
        self.settings_tab.tv_library_rows.clear()
        
        for lib in self.config.tv_library:
            self.settings_tab.add_library_item('tv', lib)
        
        # Load Movie libraries
        for row in self.settings_tab.movie_library_rows:
            row['frame'].destroy()
        self.settings_tab.movie_library_rows.clear()
        
        for lib in self.config.movie_library:
            self.settings_tab.add_library_item('movie', lib)
        
        # Load Mediux filters
        for row in self.settings_tab.mediux_filters_rows:
            row['frame'].destroy()
        self.settings_tab.mediux_filters_rows.clear()
        
        for filter_val in self.config.mediux_filters:
            self.settings_tab.add_library_item('mediux', filter_val)
        
        # Load worker count
        if self.max_workers_var:
            self.max_workers_var.set(self.config.max_workers)
        
        # Load scraper delay settings
        if self.initial_delay_var:
            self.initial_delay_var.set(self.config.scraper_initial_delay)
        if self.min_delay_var:
            self.min_delay_var.set(self.config.scraper_min_delay)
        if self.max_delay_var:
            self.max_delay_var.set(self.config.scraper_max_delay)
        if self.batch_delay_var:
            self.batch_delay_var.set(self.config.scraper_batch_delay)
        if self.page_wait_min_var:
            self.page_wait_min_var.set(self.config.scraper_page_wait_min)
        if self.page_wait_max_var:
            self.page_wait_max_var.set(self.config.scraper_page_wait_max)
        
        # Update preset button highlighting
        self.settings_tab.update_preset_buttons()
        
        # Load log file path and append preference
        if self.settings_tab.log_file_entry:
            self.settings_tab.log_file_entry.delete(0, ctk.END)
            self.settings_tab.log_file_entry.insert(0, self.config.log_file or "debug.log")
        if getattr(self.settings_tab, 'log_append_var', None) is not None:
            try:
                self.settings_tab.log_append_var.set(bool(getattr(self.config, 'log_append', False)))
            except Exception:
                self.settings_tab.log_append_var.set(False)
        
        # Load bulk import file
        self.bulk_import_tab.load_file()
        
        # Load title mappings
        self.title_mappings_tab.load_mappings()
        
        # Initialize poster scrape with one empty row if needed
        if len(self.poster_scrape_tab.rows) == 0:
            self.poster_scrape_tab.add_url_row()
    
    def _save_config(self):
        """Save configuration from UI fields."""
        try:
            self.logger.info("Saving configuration from UI...")
        except Exception:
            pass
        # Save basic settings
        self.config.base_url = self.base_url_entry.get().strip()
        self.config.token = self.token_entry.get().strip()
        
        # Save TV libraries
        tv_libs = []
        for row in self.settings_tab.tv_library_rows:
            lib_name = row['entry'].get().strip()
            if lib_name:
                tv_libs.append(lib_name)
        self.config.tv_library = tv_libs
        
        # Save Movie libraries
        movie_libs = []
        for row in self.settings_tab.movie_library_rows:
            lib_name = row['entry'].get().strip()
            if lib_name:
                movie_libs.append(lib_name)
        self.config.movie_library = movie_libs
        
        # Save Mediux filters
        mediux_filters = []
        for row in self.settings_tab.mediux_filters_rows:
            filter_val = row['entry'].get().strip()
            if filter_val:
                mediux_filters.append(filter_val)
        self.config.mediux_filters = mediux_filters
        
        # Save worker count
        if self.max_workers_var:
            self.config.max_workers = self.max_workers_var.get()
        
        # Save scraper delay settings
        if self.initial_delay_var:
            self.config.scraper_initial_delay = self.initial_delay_var.get()
        if self.min_delay_var:
            self.config.scraper_min_delay = self.min_delay_var.get()
        if self.max_delay_var:
            self.config.scraper_max_delay = self.max_delay_var.get()
        if self.batch_delay_var:
            self.config.scraper_batch_delay = self.batch_delay_var.get()
        if self.page_wait_min_var:
            self.config.scraper_page_wait_min = self.page_wait_min_var.get()
        if self.page_wait_max_var:
            self.config.scraper_page_wait_max = self.page_wait_max_var.get()
        
        # Save log file path and append preference
        if self.settings_tab.log_file_entry:
            self.config.log_file = self.settings_tab.log_file_entry.get().strip() or "debug.log"
        if getattr(self.settings_tab, 'log_append_var', None) is not None:
            try:
                self.config.log_append = bool(self.settings_tab.log_append_var.get())
            except Exception:
                self.config.log_append = False
        
        # Save to file
        try:
            self.config_manager.save(self.config)
            self.logger.info(f"Configuration saved to {self.config_manager.config_path}")
        except Exception as e:
            self.logger.exception(f"Error saving configuration: {e}")
            self._update_status(f"Error saving configuration: {e}", color="red")
            return
        
        # Update logger with new log file and append preference
        try:
            self.logger.configure(log_file=self.config.log_file, append=bool(getattr(self.config, 'log_append', False)))
        except Exception:
            try:
                self.logger.configure(log_file=self.config.log_file)
            except Exception:
                pass
        
        # Reinitialize Plex service with new credentials
        self.plex_service = PlexService(self.config)
        tv_libs, movie_libs = self.plex_service.setup(gui_mode=True)
        
        # Reinitialize upload service with updated Plex service
        if self.plex_service:
            self.upload_service = PosterUploadService(self.plex_service)
        
        # Reinitialize scraper factory with updated config
        self.scraper_factory = ScraperFactory(config=self.config)
        try:
            self.logger.info(f"Saved configuration: base_url={self.config.base_url}, token_set={'yes' if self.config.token else 'no'}")
            self._update_status("Configuration saved successfully!", color="#E5A00D")
        except Exception:
            self._update_status("Configuration saved successfully!", color="#E5A00D")
        
        # Refresh the Reset Posters tab if Plex setup was successful
        if tv_libs or movie_libs:
            self.app.after(100, lambda: self.label_handler.refresh_labeled_items())
    
    def _setup_services(self):
        """Initialize Plex and upload services."""
        if not self.plex_service:
            self.plex_service = PlexService(self.config)
            self.plex_service.setup(gui_mode=True)
        elif not self.plex_service.tv_libraries and not self.plex_service.movie_libraries:
            # Plex service exists but libraries aren't loaded - try setting up again
            self.plex_service.setup(gui_mode=True)
        
        if not self.upload_service and self.plex_service:
            self.upload_service = PosterUploadService(self.plex_service)
        
        if not self.scraper_factory:
            self.scraper_factory = ScraperFactory(
                config=self.config
            )
    
    def _run_url_scrape_thread(self):
        """Run URL scraping in a separate thread."""
        urls = self.poster_scrape_tab.get_urls()
        
        if not urls:
            self._update_status("No URLs to scrape", color="orange")
            return
        
        self._disable_buttons()
        try:
            self.logger.info(f"Starting URL scrape for {len(urls)} URL(s)")
        except Exception:
            pass
        threading.Thread(
            target=self.scrape_handler.process_scrape_urls,
            args=(urls, self.poster_scrape_rows),
            daemon=True
        ).start()
    
    def _run_bulk_import_thread(self):
        """Run bulk import in a separate thread."""
        urls = self.bulk_import_tab.get_urls()
        
        if not urls:
            self._update_status("No URLs in bulk file", color="orange")
            return
        
        self._disable_buttons()
        try:
            self.logger.info(f"Starting bulk import for {len(urls)} URL(s) from {self.bulk_import_tab.app.current_bulk_file if hasattr(self.bulk_import_tab, 'app') else self.current_bulk_file}")
        except Exception:
            pass
        threading.Thread(
            target=self.scrape_handler.process_scrape_urls,
            args=(urls, self.bulk_import_rows),
            daemon=True
        ).start()
    
    def _disable_buttons(self):
        """Disable action buttons during operations."""
        if self.poster_scrape_tab.scrape_button:
            self.poster_scrape_tab.scrape_button.configure(state="disabled")
        if self.bulk_import_tab.import_button:
            self.bulk_import_tab.import_button.configure(state="disabled")
    
    def _enable_buttons(self):
        """Enable action buttons after operations."""
        if self.poster_scrape_tab.scrape_button:
            self.poster_scrape_tab.scrape_button.configure(state="normal")
        if self.bulk_import_tab.import_button:
            self.bulk_import_tab.import_button.configure(state="normal")
    
    def _update_status(self, message: str, color: str = "white"):
        """Update status label."""
        if color == "red":
            self.logger.error(message)
        elif color in ["orange", "#FF6B6B"]:
            self.logger.warning(message)
        else:
            self.logger.info(message)
        
        self.app.after(0, lambda: self.status_label.configure(text=message, text_color=color))
    
    def _update_progress(self, current: int, total: int, url: str = "", active_count: int = 0):
        """Update progress bar and label."""
        def update():
            if total > 0:
                progress = current / total
                self.progress_bar.set(progress)
                self.progress_bar.pack(fill="x", padx=0, pady=(0, 3))
                
                if active_count > 0:
                    progress_text = f"Processing {current}/{total} URLs ({active_count} active workers)"
                else:
                    progress_text = f"Processing {current}/{total} URLs"
                
                if url:
                    progress_text += f"\nCurrent: {url[:80]}..."
                
                self.progress_label.configure(text=progress_text)
                self.progress_label.pack(fill="x", pady=(0, 2))
        
        self.app.after(0, update)
    
    def _hide_progress(self):
        """Hide progress bar and label."""
        def hide():
            self.progress_bar.pack_forget()
            self.progress_label.pack_forget()
            if self.cancel_button:
                self.cancel_button.pack_forget()
        
        self.app.after(0, hide)
    
    def _show_cancel_button(self):
        """Show cancel button."""
        def show():
            if self.cancel_button:
                self.cancel_button.pack(pady=(0, 5))
        
        self.app.after(0, show)
    
    def _cancel_operation(self):
        """Cancel the current operation."""
        self.is_cancelled = True
        self.scrape_handler.cancel()
        self._update_status("Cancelling operation...", color="#FF6B6B")
        if self.cancel_button:
            self.cancel_button.configure(state="disabled")
    
    def _set_url_row_status(self, url: str, status: str, row_list: list):
        """Set visual status for a URL row."""
        def update():
            for row in row_list:
                if row.get('entry') and row['entry'].get().strip() == url:
                    if status == 'processing':
                        # Yellow border for processing
                        row['entry'].configure(border_width=2, border_color="#E5A00D")
                    elif status == 'completed':
                        # Green border for completed
                        row['entry'].configure(border_width=2, border_color="#4CAF50")
                    elif status == 'error':
                        # Red border for error
                        row['entry'].configure(border_width=2, border_color="#FF6B6B")
                    else:
                        # Reset to default
                        row['entry'].configure(border_width=1, border_color="#484848")
                    break
        
        self.app.after(0, update)
    
    @property
    def poster_scrape_rows(self):
        """Get current poster scrape rows dynamically."""
        if self.poster_scrape_tab:
            return self.poster_scrape_tab.rows
        return []
    
    @property
    def bulk_import_rows(self):
        """Get current bulk import rows dynamically."""
        if self.bulk_import_tab:
            return self.bulk_import_tab.rows
        return []
    
    @property
    def title_mappings_rows(self):
        """Get current title mappings rows dynamically."""
        if self.title_mappings_tab:
            return self.title_mappings_tab.rows
        return []
