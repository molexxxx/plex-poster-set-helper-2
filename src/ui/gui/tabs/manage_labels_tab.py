"""Manage Labels tab for viewing and resetting labeled posters."""

import tkinter as tk
import customtkinter as ctk


class ManageLabelsTab:
    """Manages the Reset Posters tab interface."""
    
    def __init__(self, parent, app):
        """Initialize Manage Labels tab.
        
        Args:
            parent: Parent tab view widget.
            app: Main application instance.
        """
        self.app = app
        self.tab = parent.add("Reset Posters")
        self.scroll_frame = None
        self.count_label = None
        self.library_label = None
        self.source_label = None
        self.search_var = None
        self.filter_mediux = None
        self.filter_posterdb = None
        self.filter_movies = None
        self.filter_tv = None
        
        self._create_ui()
    
    def _create_ui(self):
        """Create the tab UI."""
        self.tab.grid_columnconfigure(0, weight=1)
        self.tab.grid_rowconfigure(1, weight=1)
        
        info_label = ctk.CTkLabel(
            self.tab,
            text="View and manage posters uploaded by this app",
            text_color="#696969",
            font=("Roboto", 15)
        )
        info_label.grid(row=0, column=0, pady=(5, 3), padx=5, sticky="w")
        
        # Stats frame
        stats_frame = ctk.CTkFrame(self.tab, fg_color="#1C1E1E", corner_radius=8)
        stats_frame.grid(row=1, column=0, padx=10, pady=(0, 8), sticky="ew")
        stats_frame.grid_columnconfigure(0, weight=1)
        stats_frame.grid_columnconfigure(1, weight=1)
        
        self.count_label = ctk.CTkLabel(
            stats_frame,
            text="Found 0 items with custom posters",
            text_color="#E5A00D",
            font=("Roboto", 15, "bold"),
            anchor="w"
        )
        self.count_label.grid(row=0, column=0, columnspan=2, pady=(10, 2), padx=10, sticky="w")
        
        self.library_label = ctk.CTkLabel(
            stats_frame,
            text="",
            text_color="#CECECE",
            font=("Roboto", 12),
            anchor="w",
            justify="left"
        )
        self.library_label.grid(row=1, column=0, pady=(0, 10), padx=10, sticky="nw")
        
        self.source_label = ctk.CTkLabel(
            stats_frame,
            text="",
            text_color="#CECECE",
            font=("Roboto", 12),
            anchor="w",
            justify="left"
        )
        self.source_label.grid(row=1, column=1, pady=(0, 10), padx=10, sticky="nw")
        
        # Filter frame
        filter_frame = ctk.CTkFrame(self.tab, fg_color="#1C1E1E", corner_radius=8)
        filter_frame.grid(row=2, column=0, padx=10, pady=(0, 8), sticky="ew")
        filter_frame.grid_columnconfigure(1, weight=1)
        
        filter_label = ctk.CTkLabel(
            filter_frame,
            text="🔍 Filter:",
            text_color="#CECECE",
            font=("Roboto", 12, "bold")
        )
        filter_label.grid(row=0, column=0, padx=(10, 5), pady=(8, 4), sticky="w")
        
        # Search box
        self.search_var = tk.StringVar()
        self.search_var.trace_add('write', lambda *args: self.app.label_handler.apply_label_filters())
        search_entry = ctk.CTkEntry(
            filter_frame,
            textvariable=self.search_var,
            placeholder_text="Search by title...",
            width=250,
            height=28,
            font=("Roboto", 12)
        )
        search_entry.grid(row=0, column=1, columnspan=5, padx=5, pady=(8, 4), sticky="ew")
        
        # Source filter checkboxes
        self.filter_mediux = tk.BooleanVar(value=True)
        self.filter_posterdb = tk.BooleanVar(value=True)
        self.filter_movies = tk.BooleanVar(value=True)
        self.filter_tv = tk.BooleanVar(value=True)
        
        # Checkbox row
        checkbox_label = ctk.CTkLabel(
            filter_frame,
            text="Source:",
            text_color="#A0A0A0",
            font=("Roboto", 11)
        )
        checkbox_label.grid(row=1, column=0, padx=(10, 5), pady=(4, 8), sticky="w")
        
        mediux_check = ctk.CTkCheckBox(
            filter_frame,
            text="🌐 MediUX",
            variable=self.filter_mediux,
            command=self.app.label_handler.apply_label_filters,
            font=("Roboto", 11),
            checkbox_width=18,
            checkbox_height=18,
            fg_color="#E5A00D",
            hover_color="#FFA500",
            border_color="#484848"
        )
        mediux_check.grid(row=1, column=1, padx=5, pady=(4, 8), sticky="w")
        
        posterdb_check = ctk.CTkCheckBox(
            filter_frame,
            text="🎨 ThePosterDB",
            variable=self.filter_posterdb,
            command=self.app.label_handler.apply_label_filters,
            font=("Roboto", 11),
            checkbox_width=18,
            checkbox_height=18,
            fg_color="#E5A00D",
            hover_color="#FFA500",
            border_color="#484848"
        )
        posterdb_check.grid(row=1, column=2, padx=5, pady=(4, 8), sticky="w")
        
        sep_label = ctk.CTkLabel(
            filter_frame,
            text="|",
            text_color="#484848",
            font=("Roboto", 11)
        )
        sep_label.grid(row=1, column=3, padx=5, pady=(4, 8), sticky="w")
        
        type_label = ctk.CTkLabel(
            filter_frame,
            text="Type:",
            text_color="#A0A0A0",
            font=("Roboto", 11)
        )
        type_label.grid(row=1, column=4, padx=(5, 5), pady=(4, 8), sticky="w")
        
        movies_check = ctk.CTkCheckBox(
            filter_frame,
            text="🎬 Movies",
            variable=self.filter_movies,
            command=self.app.label_handler.apply_label_filters,
            font=("Roboto", 11),
            checkbox_width=18,
            checkbox_height=18,
            fg_color="#E5A00D",
            hover_color="#FFA500",
            border_color="#484848"
        )
        movies_check.grid(row=1, column=5, padx=5, pady=(4, 8), sticky="w")
        
        tv_check = ctk.CTkCheckBox(
            filter_frame,
            text="📺 TV Shows",
            variable=self.filter_tv,
            command=self.app.label_handler.apply_label_filters,
            font=("Roboto", 11),
            checkbox_width=18,
            checkbox_height=18,
            fg_color="#E5A00D",
            hover_color="#FFA500",
            border_color="#484848"
        )
        tv_check.grid(row=1, column=6, padx=5, pady=(4, 8), sticky="w")
        
        clear_btn = ctk.CTkButton(
            filter_frame,
            text="Clear",
            command=self.app.label_handler.clear_label_filters,
            width=60,
            height=26,
            font=("Roboto", 11),
            fg_color="#484848",
            hover_color="#5A5A5A"
        )
        clear_btn.grid(row=1, column=7, padx=(10, 10), pady=(4, 8), sticky="e")
        
        # Auto-load items when tab is created
        self.app.app.after(100, lambda: self.app.label_handler.refresh_labeled_items())
        
        # Scrollable list frame
        self.scroll_frame = self.app.ui_helpers.create_scrollable_frame(self.tab)
        self.scroll_frame.grid(row=3, column=0, padx=10, pady=(0, 5), sticky="nsew")
        self.scroll_frame.grid_columnconfigure(0, weight=1)
        
        self.tab.grid_rowconfigure(3, weight=1)
        
        # Button frame
        button_frame = ctk.CTkFrame(self.tab, fg_color="transparent")
        button_frame.grid(row=4, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=1)
        button_frame.grid_columnconfigure(1, weight=0)
        
        refresh_button = self.app.ui_helpers.create_button(
            button_frame, text="Refresh", 
            command=lambda: self.app.label_handler.refresh_labeled_items())
        refresh_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="w")
        
        delete_posters_button = self.app.ui_helpers.create_button(
            button_frame,
            text="Reset All to Default",
            command=lambda: self.app.label_handler.delete_labeled_posters(),
            primary=True
        )
        delete_posters_button.grid(row=0, column=1, pady=0, padx=5, ipadx=15, sticky="e")
