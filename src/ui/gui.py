"""GUI application for Plex Poster Set Helper."""

import os
import threading
import webbrowser
import tkinter as tk
from typing import List
from concurrent.futures import ThreadPoolExecutor, as_completed

import customtkinter as ctk
from PIL import Image

from ..core.config import ConfigManager, Config
from ..services.plex_service import PlexService
from ..services.poster_upload_service import PosterUploadService
from ..scrapers.scraper_factory import ScraperFactory
from ..utils.helpers import resource_path, get_exe_dir
from ..utils.text_utils import parse_urls


class PlexPosterGUI:
    """Main GUI application."""
    
    def __init__(self):
        """Initialize the GUI application."""
        self.config_manager = ConfigManager()
        self.config = self.config_manager.load()
        
        self.plex_service: PlexService = None
        self.upload_service: PosterUploadService = None
        self.scraper_factory: ScraperFactory = None
        
        # GUI widgets (to be initialized)
        self.app = None
        self.status_label = None
        self.progress_bar = None
        self.progress_label = None
        self.bulk_import_scroll = None
        self.bulk_import_rows = []
        self.bulk_file_dropdown = None
        self.current_bulk_file = None
        self.poster_scrape_scroll = None
        self.poster_scrape_rows = []
        self.base_url_entry = None
        self.token_entry = None
        self.tv_library_container = None
        self.tv_library_rows = []
        self.movie_library_container = None
        self.movie_library_rows = []
        self.mediux_filters_container = None
        self.mediux_filters_rows = []
        self.scrape_button = None
        self.clear_button = None
        self.bulk_import_button = None
        self.add_bulk_url_button = None
        self.add_scrape_url_button = None
        self.global_context_menu = None
        self.title_mappings_scroll = None
        self.title_mappings_rows = []
        self.max_workers_var = None
        self.cancel_button = None
        self.is_cancelled = False
        self.active_executor = None
    
    def run(self):
        """Run the GUI application."""
        self._create_ui()
        self.app.mainloop()
    
    def _create_ui(self):
        """Create the main UI window."""
        self.app = ctk.CTk()
        ctk.set_appearance_mode("dark")
        
        self.app.title("Plex Poster Upload Helper")
        self.app.geometry("750x822")
        
        try:
            self.app.iconbitmap(resource_path("icons/Plex.ico"))
        except:
            pass  # Icon file not found
        
        self.app.configure(fg_color="#2A2B2B")
        
        # Set up window close handler
        self.app.protocol("WM_DELETE_WINDOW", self._on_closing)
        
        self._create_context_menu()
        self._create_link_bar()
        self._create_tabview()
        self._create_status_label()
        
        self._load_and_update_ui()
    
    def _create_context_menu(self):
        """Create right-click context menu."""
        self.global_context_menu = tk.Menu(self.app, tearoff=0)
        self.global_context_menu.add_command(label="Cut")
        self.global_context_menu.add_command(label="Copy")
        self.global_context_menu.add_command(label="Paste")
    
    def _on_closing(self):
        """Handle window close event with proper cleanup."""
        # Cancel any running operations
        self.is_cancelled = True
        
        # Shutdown active executor if any
        if self.active_executor:
            try:
                self.active_executor.shutdown(wait=False)
            except:
                pass
        
        # Close browser instances if any
        if self.scraper_factory:
            try:
                self.scraper_factory.cleanup()
            except:
                pass
        
        # Destroy the window
        self.app.destroy()
    
    def _create_link_bar(self):
        """Create the link bar at the top."""
        link_bar = ctk.CTkFrame(self.app, fg_color="transparent")
        link_bar.pack(fill="x", pady=5, padx=10)
        
        # Plex link
        base_url = self.config.base_url if self.config.base_url else "https://www.plex.tv"
        
        try:
            plex_icon = ctk.CTkImage(
                light_image=Image.open(resource_path("icons/Plex.ico")),
                size=(24, 24)
            )
            icon_label = ctk.CTkLabel(link_bar, image=plex_icon, text="", anchor="w")
            icon_label.pack(side="left", padx=0, pady=0)
        except:
            pass
        
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
        mediux_button = self._create_button(
            link_bar,
            text="MediUX.pro",
            command=lambda: webbrowser.open("https://mediux.pro"),
            color="#945af2",
            height=30
        )
        mediux_button.pack(side="right", padx=5)
        
        posterdb_button = self._create_button(
            link_bar,
            text="ThePosterDB",
            command=lambda: webbrowser.open("https://theposterdb.com"),
            color="#FA6940",
            height=30
        )
        posterdb_button.pack(side="right", padx=5)
    
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
        
        self._create_poster_scrape_tab(tabview)
        self._create_bulk_import_tab(tabview)
        self._create_title_mappings_tab(tabview)
        self._create_settings_tab(tabview)
        
        self._set_default_tab(tabview)
    
    def _create_settings_tab(self, tabview):
        """Create settings tab."""
        settings_tab = tabview.add("Settings")
        settings_tab.grid_columnconfigure(0, weight=1)
        settings_tab.grid_rowconfigure(0, weight=1, minsize=560)
        
        # Create main scrollable container
        main_scroll = ctk.CTkScrollableFrame(
            settings_tab,
            fg_color="transparent",
            scrollbar_button_color="#484848",
            scrollbar_button_hover_color="#696969"
        )
        main_scroll.grid(row=0, column=0, padx=0, pady=(0, 5), sticky="nsew")
        main_scroll.grid_columnconfigure(0, weight=1)
        
        row = 0
        
        # Plex Base URL
        base_url_label = ctk.CTkLabel(main_scroll, text="Plex Base URL", text_color="#696969", font=("Roboto", 15))
        base_url_label.grid(row=row, column=0, pady=(10, 5), padx=10, sticky="w")
        row += 1
        
        self.base_url_entry = ctk.CTkEntry(
            main_scroll,
            placeholder_text="Enter Plex Base URL",
            fg_color="#1C1E1E",
            text_color="#A1A1A1",
            border_width=0,
            height=40
        )
        self.base_url_entry.grid(row=row, column=0, pady=(0, 10), padx=10, sticky="ew")
        self._bind_context_menu(self.base_url_entry)
        row += 1
        
        # Plex Token
        token_label = ctk.CTkLabel(main_scroll, text="Plex Token", text_color="#696969", font=("Roboto", 15))
        token_label.grid(row=row, column=0, pady=5, padx=10, sticky="w")
        row += 1
        
        self.token_entry = ctk.CTkEntry(
            main_scroll,
            placeholder_text="Enter Plex Token",
            fg_color="#1C1E1E",
            text_color="#A1A1A1",
            border_width=0,
            height=40
        )
        self.token_entry.grid(row=row, column=0, pady=(0, 10), padx=10, sticky="ew")
        self._bind_context_menu(self.token_entry)
        row += 1
        
        # TV Library Names with inline add
        tv_header_frame = ctk.CTkFrame(main_scroll, fg_color="transparent")
        tv_header_frame.grid(row=row, column=0, pady=(5, 5), padx=10, sticky="ew")
        tv_header_frame.grid_columnconfigure(0, weight=1)
        
        tv_label = ctk.CTkLabel(tv_header_frame, text="TV Library Names", text_color="#696969", font=("Roboto", 14))
        tv_label.grid(row=0, column=0, sticky="w")
        
        tv_add_button = self._create_button(tv_header_frame, text="+ Add", command=lambda: self._add_library_item('tv'), height=26)
        tv_add_button.grid(row=0, column=1, padx=5, ipadx=8, sticky="e")
        row += 1
        
        # Container for TV library items
        self.tv_library_container = ctk.CTkFrame(main_scroll, fg_color="#1C1E1E", corner_radius=5)
        self.tv_library_container.grid(row=row, column=0, padx=10, pady=(0, 10), sticky="ew")
        self.tv_library_container.grid_columnconfigure(0, weight=1)
        self.tv_library_rows = []
        row += 1
        
        # Movie Library Names with inline add
        movie_header_frame = ctk.CTkFrame(main_scroll, fg_color="transparent")
        movie_header_frame.grid(row=row, column=0, pady=(5, 5), padx=10, sticky="ew")
        movie_header_frame.grid_columnconfigure(0, weight=1)
        
        movie_label = ctk.CTkLabel(movie_header_frame, text="Movie Library Names", text_color="#696969", font=("Roboto", 14))
        movie_label.grid(row=0, column=0, sticky="w")
        
        movie_add_button = self._create_button(movie_header_frame, text="+ Add", command=lambda: self._add_library_item('movie'), height=26)
        movie_add_button.grid(row=0, column=1, padx=5, ipadx=8, sticky="e")
        row += 1
        
        # Container for Movie library items
        self.movie_library_container = ctk.CTkFrame(main_scroll, fg_color="#1C1E1E", corner_radius=5)
        self.movie_library_container.grid(row=row, column=0, padx=10, pady=(0, 10), sticky="ew")
        self.movie_library_container.grid_columnconfigure(0, weight=1)
        self.movie_library_rows = []
        row += 1
        
        # Mediux Filters with inline add
        mediux_header_frame = ctk.CTkFrame(main_scroll, fg_color="transparent")
        mediux_header_frame.grid(row=row, column=0, pady=(5, 5), padx=10, sticky="ew")
        mediux_header_frame.grid_columnconfigure(0, weight=1)
        
        mediux_label = ctk.CTkLabel(mediux_header_frame, text="Mediux Filters", text_color="#696969", font=("Roboto", 14))
        mediux_label.grid(row=0, column=0, sticky="w")
        
        mediux_add_button = self._create_button(mediux_header_frame, text="+ Add", command=lambda: self._add_library_item('mediux'), height=26)
        mediux_add_button.grid(row=0, column=1, padx=5, ipadx=8, sticky="e")
        row += 1
        
        # Container for Mediux filter items
        self.mediux_filters_container = ctk.CTkFrame(main_scroll, fg_color="#1C1E1E", corner_radius=5)
        self.mediux_filters_container.grid(row=row, column=0, padx=10, pady=(0, 10), sticky="ew")
        self.mediux_filters_container.grid_columnconfigure(0, weight=1)
        self.mediux_filters_rows = []
        row += 1
        
        # Max Concurrent Workers
        max_workers_frame = ctk.CTkFrame(main_scroll, fg_color="transparent")
        max_workers_frame.grid(row=row, column=0, pady=(5, 10), padx=10, sticky="ew")
        max_workers_frame.grid_columnconfigure(1, weight=1)
        
        cpu_count = os.cpu_count() or 4
        default_workers = min(3, cpu_count)
        
        max_workers_label = ctk.CTkLabel(max_workers_frame, text="Max Concurrent Workers", text_color="#696969", font=("Roboto", 14))
        max_workers_label.grid(row=0, column=0, pady=0, padx=(0, 10), sticky="w")
        
        self.max_workers_var = tk.IntVar(value=default_workers)
        max_workers_slider = ctk.CTkSlider(
            max_workers_frame,
            from_=1,
            to=cpu_count,
            number_of_steps=cpu_count - 1,
            variable=self.max_workers_var,
            fg_color="#1C1E1E",
            progress_color="#E5A00D",
            button_color="#E5A00D",
            button_hover_color="#FFA500"
        )
        max_workers_slider.grid(row=0, column=1, pady=0, padx=0, sticky="ew")
        
        max_workers_value_label = ctk.CTkLabel(max_workers_frame, textvariable=self.max_workers_var, text_color="#E5A00D", font=("Roboto", 15, "bold"))
        max_workers_value_label.grid(row=0, column=1, pady=0, padx=0, sticky="e")
        
        # Buttons fixed at bottom outside scroll area
        button_frame = ctk.CTkFrame(settings_tab, fg_color="transparent")
        button_frame.grid(row=1, column=0, pady=5, padx=10, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=1)
        button_frame.grid_columnconfigure(1, weight=1)
        
        reload_button = self._create_button(button_frame, text="Reload", command=self._load_and_update_ui)
        reload_button.grid(row=0, column=0, pady=0, padx=(0, 5), sticky="ew")
        
        save_button = self._create_button(button_frame, text="Save", command=self._save_config, primary=True)
        save_button.grid(row=0, column=1, pady=0, padx=(5, 0), sticky="ew")
    
    def _create_bulk_import_tab(self, tabview):
        """Create bulk import tab."""
        bulk_import_tab = tabview.add("Bulk Import")
        
        bulk_import_tab.grid_columnconfigure(0, weight=1)
        
        # File selection header
        file_selection_frame = ctk.CTkFrame(bulk_import_tab, fg_color="transparent")
        file_selection_frame.grid(row=0, column=0, pady=5, padx=5, sticky="ew")
        file_selection_frame.grid_columnconfigure(1, weight=1)
        
        file_label = ctk.CTkLabel(
            file_selection_frame,
            text="Bulk File:",
            text_color="#696969",
            font=("Roboto", 14)
        )
        file_label.grid(row=0, column=0, padx=(0, 5), sticky="w")
        
        # Initialize current bulk file
        if not self.current_bulk_file and self.config.bulk_files:
            self.current_bulk_file = self.config.bulk_files[0]
        
        self.bulk_file_dropdown = ctk.CTkOptionMenu(
            file_selection_frame,
            values=self.config.bulk_files if self.config.bulk_files else ["bulk_import.txt"],
            command=self._on_bulk_file_changed,
            fg_color="#1C1E1E",
            button_color="#484848",
            button_hover_color="#696969",
            dropdown_fg_color="#2A2B2B",
            text_color="#E5A00D",
            font=("Roboto", 13)
        )
        self.bulk_file_dropdown.grid(row=0, column=1, padx=5, sticky="ew")
        self.bulk_file_dropdown.set(self.current_bulk_file or "bulk_import.txt")
        
        new_file_button = self._create_button(file_selection_frame, text="New File", command=self._create_new_bulk_file)
        new_file_button.grid(row=0, column=2, padx=5, ipadx=10, sticky="ew")
        
        delete_file_button = self._create_button(file_selection_frame, text="Delete File", command=self._delete_bulk_file)
        delete_file_button.grid(row=0, column=3, padx=5, ipadx=10, sticky="ew")
        
        info_label = ctk.CTkLabel(
            bulk_import_tab,
            text="Bulk import multiple poster URLs",
            text_color="#696969",
            font=("Roboto", 13)
        )
        info_label.grid(row=1, column=0, pady=(0, 5), padx=5, sticky="w")
        
        # Scrollable frame for URLs
        self.bulk_import_scroll = ctk.CTkScrollableFrame(
            bulk_import_tab,
            fg_color="#1C1E1E",
            scrollbar_button_color="#484848",
            scrollbar_button_hover_color="#696969"
        )
        self.bulk_import_scroll.grid(row=2, column=0, padx=10, pady=5, sticky="nsew")
        self.bulk_import_scroll.grid_columnconfigure(0, weight=1)
        self.bulk_import_scroll.grid_columnconfigure(1, weight=0)
        
        bulk_import_tab.grid_rowconfigure(2, weight=1)
        
        button_frame = ctk.CTkFrame(bulk_import_tab, fg_color="transparent")
        button_frame.grid(row=3, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=0)
        button_frame.grid_columnconfigure(1, weight=0)
        button_frame.grid_columnconfigure(2, weight=1)
        button_frame.grid_columnconfigure(3, weight=0)
        
        self.add_bulk_url_button = self._create_button(button_frame, text="Add URL", command=self._add_bulk_url_row)
        self.add_bulk_url_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="ew")
        
        reload_button = self._create_button(button_frame, text="Reload File", command=self._load_bulk_import_file)
        reload_button.grid(row=0, column=1, pady=0, padx=5, ipadx=15, sticky="ew")
        
        save_button = self._create_button(button_frame, text="Save Changes", command=self._save_bulk_import_file)
        save_button.grid(row=0, column=2, pady=0, padx=5, sticky="ew")
        
        self.bulk_import_button = self._create_button(
            button_frame,
            text="Run Bulk Import",
            command=self._run_bulk_import_thread,
            primary=True
        )
        self.bulk_import_button.grid(row=0, column=3, pady=0, padx=5, ipadx=15, sticky="ew")
    
    def _create_poster_scrape_tab(self, tabview):
        """Create poster scrape tab."""
        poster_scrape_tab = tabview.add("Poster Scrape")
        
        poster_scrape_tab.grid_columnconfigure(0, weight=1)
        
        url_label = ctk.CTkLabel(
            poster_scrape_tab,
            text="Quick poster scraping - Supports ThePosterDB sets, MediUX sets, or ThePosterDB user URLs",
            text_color="#696969",
            font=("Roboto", 15)
        )
        url_label.grid(row=0, column=0, pady=5, padx=5, sticky="w")
        
        # Scrollable frame for URLs
        self.poster_scrape_scroll = ctk.CTkScrollableFrame(
            poster_scrape_tab,
            fg_color="#1C1E1E",
            scrollbar_button_color="#484848",
            scrollbar_button_hover_color="#696969"
        )
        self.poster_scrape_scroll.grid(row=1, column=0, padx=10, pady=5, sticky="nsew")
        self.poster_scrape_scroll.grid_columnconfigure(0, weight=1)
        self.poster_scrape_scroll.grid_columnconfigure(1, weight=0)
        
        poster_scrape_tab.grid_rowconfigure(1, weight=1)
        
        button_frame = ctk.CTkFrame(poster_scrape_tab, fg_color="transparent")
        button_frame.grid(row=2, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=0)
        button_frame.grid_columnconfigure(1, weight=0)
        button_frame.grid_columnconfigure(2, weight=1)
        
        self.add_scrape_url_button = self._create_button(button_frame, text="Add URL", command=self._add_scrape_url_row)
        self.add_scrape_url_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="ew")
        
        self.clear_button = self._create_button(button_frame, text="Clear All", command=self._clear_scrape_urls)
        self.clear_button.grid(row=0, column=1, pady=0, padx=5, ipadx=15, sticky="ew")
        
        self.scrape_button = self._create_button(
            button_frame,
            text="Run Scrape",
            command=self._run_url_scrape_thread,
            primary=True
        )
        self.scrape_button.grid(row=0, column=2, pady=0, padx=5, sticky="ew")
    
    def _create_title_mappings_tab(self, tabview):
        """Create title mappings editor tab."""
        mappings_tab = tabview.add("Title Mappings")
        
        mappings_tab.grid_columnconfigure(0, weight=1)
        
        info_label = ctk.CTkLabel(
            mappings_tab,
            text="Map poster titles to your Plex library titles",
            text_color="#696969",
            font=("Roboto", 15)
        )
        info_label.grid(row=0, column=0, pady=5, padx=5, sticky="w")
        
        # Column headers frame
        headers_frame = ctk.CTkFrame(mappings_tab, fg_color="transparent")
        headers_frame.grid(row=1, column=0, padx=10, pady=(5, 0), sticky="ew")
        headers_frame.grid_columnconfigure(0, weight=1)
        headers_frame.grid_columnconfigure(1, weight=1)
        headers_frame.grid_columnconfigure(2, weight=0)
        
        poster_header = ctk.CTkLabel(
            headers_frame,
            text="Poster URL Title",
            text_color="#E5A00D",
            font=("Roboto", 13, "bold")
        )
        poster_header.grid(row=0, column=0, padx=(5, 2), pady=2, sticky="w")
        
        plex_header = ctk.CTkLabel(
            headers_frame,
            text="Plex Library Title",
            text_color="#E5A00D",
            font=("Roboto", 13, "bold")
        )
        plex_header.grid(row=0, column=1, padx=(2, 2), pady=2, sticky="w")
        
        # Scrollable frame for mappings
        self.title_mappings_scroll = ctk.CTkScrollableFrame(
            mappings_tab,
            fg_color="#1C1E1E",
            scrollbar_button_color="#484848",
            scrollbar_button_hover_color="#696969"
        )
        self.title_mappings_scroll.grid(row=2, column=0, padx=10, pady=(0, 5), sticky="nsew")
        self.title_mappings_scroll.grid_columnconfigure(0, weight=1)
        self.title_mappings_scroll.grid_columnconfigure(1, weight=1)
        self.title_mappings_scroll.grid_columnconfigure(2, weight=0)
        
        mappings_tab.grid_rowconfigure(2, weight=1)
        
        button_frame = ctk.CTkFrame(mappings_tab, fg_color="transparent")
        button_frame.grid(row=3, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=0)
        button_frame.grid_columnconfigure(1, weight=1)
        button_frame.grid_columnconfigure(2, weight=0)
        
        add_button = self._create_button(button_frame, text="Add Mapping", command=self._add_title_mapping_row)
        add_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="ew")
        
        save_button = self._create_button(button_frame, text="Save All", command=self._save_title_mappings, primary=True)
        save_button.grid(row=0, column=1, pady=0, padx=5, sticky="ew")
        
        reload_button = self._create_button(button_frame, text="Reload", command=self._load_title_mappings)
        reload_button.grid(row=0, column=2, pady=0, padx=5, ipadx=30, sticky="ew")
    
    def _create_status_label(self):
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
        self.progress_bar.pack_forget()  # Hidden by default
        
        self.progress_label = ctk.CTkLabel(status_frame, text="", text_color="#696969", font=("Roboto", 11))
        self.progress_label.pack(fill="x", pady=(0, 2))
        self.progress_label.pack_forget()  # Hidden by default
        
        # Cancel button (hidden by default)
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
        self.cancel_button.pack_forget()  # Hidden by default
        
        self.status_label = ctk.CTkLabel(status_frame, text="", text_color="#E5A00D", font=("Roboto", 12))
        self.status_label.pack(fill="x")
    
    def _create_form_row(self, parent, row: int, label_text: str, placeholder: str) -> ctk.CTkEntry:
        """Create a form row with label and entry.
        
        Args:
            parent: Parent widget.
            row: Row number.
            label_text: Label text.
            placeholder: Placeholder text for entry.
            
        Returns:
            Entry widget.
        """
        label = ctk.CTkLabel(parent, text=label_text, text_color="#696969", font=("Roboto", 15))
        label.grid(row=row, column=0, pady=5, padx=10, sticky="w")
        
        entry = ctk.CTkEntry(
            parent,
            placeholder_text=placeholder,
            fg_color="#1C1E1E",
            text_color="#A1A1A1",
            border_width=0,
            height=40
        )
        entry.grid(row=row, column=1, pady=5, padx=10, sticky="ew")
        self._bind_context_menu(entry)
        
        return entry
    
    def _create_button(self, container, text: str, command, color: str = None, primary: bool = False, height: int = 35) -> ctk.CTkButton:
        """Create a styled button.
        
        Args:
            container: Parent widget.
            text: Button text.
            command: Button command.
            color: Optional color.
            primary: Whether button is primary style.
            height: Button height.
            
        Returns:
            Button widget.
        """
        button_fg = "#2A2B2B" if color else "#1C1E1E"
        button_border = "#484848"
        button_text_color = "#CECECE" if color else "#696969"
        plex_orange = "#E5A00D"
        
        if primary:
            button_fg = plex_orange
            button_text_color, button_border = "#1C1E1E", "#1C1E1E"
        
        button = ctk.CTkButton(
            container,
            text=text,
            command=command,
            border_width=1,
            text_color=button_text_color,
            fg_color=button_fg,
            border_color=button_border,
            hover_color="#333333",
            width=80,
            height=height,
            font=("Roboto", 13, "bold"),
        )
        
        return button
    
    def _bind_context_menu(self, widget):
        """Bind context menu to widget.
        
        Args:
            widget: Widget to bind to.
        """
        widget.bind("<Button-3>", self._show_context_menu)
        widget.bind("<Control-1>", self._show_context_menu)
    
    def _show_context_menu(self, event):
        """Show context menu.
        
        Args:
            event: Event object.
        """
        widget = event.widget
        widget.focus()
        
        self.global_context_menu.entryconfigure("Cut", command=lambda: widget.event_generate("<<Cut>>"))
        self.global_context_menu.entryconfigure("Copy", command=lambda: widget.event_generate("<<Copy>>"))
        self.global_context_menu.entryconfigure("Paste", command=lambda: widget.event_generate("<<Paste>>"))
        self.global_context_menu.tk_popup(event.x_root, event.y_root)
    
    def _update_status(self, message: str, color: str = "white"):
        """Update status label.
        
        Args:
            message: Status message.
            color: Text color.
        """
        self.app.after(0, lambda: self.status_label.configure(text=message, text_color=color))
    
    def _update_progress(self, current: int, total: int, url: str = "", active_count: int = 0):
        """Update progress bar and label.
        
        Args:
            current: Current completed items.
            total: Total items.
            url: Current URL being processed.
            active_count: Number of URLs currently being processed.
        """
        def update():
            if self.progress_bar and self.progress_label:
                progress = current / total if total > 0 else 0
                self.progress_bar.set(progress)
                self.progress_bar.pack(fill="x", padx=0, pady=(0, 3))
                
                if active_count > 1:
                    label_text = f"Completed: {current}/{total} | Active workers: {active_count}"
                else:
                    label_text = f"Processing {current}/{total}"
                    if url:
                        # Truncate long URLs
                        display_url = url if len(url) <= 50 else url[:47] + "..."
                        label_text += f": {display_url}"
                self.progress_label.configure(text=label_text)
                self.progress_label.pack(fill="x", pady=(0, 2))
        
        self.app.after(0, update)
    
    def _hide_progress(self):
        """Hide progress bar and label."""
        def hide():
            if self.progress_bar and self.progress_label:
                self.progress_bar.pack_forget()
                self.progress_label.pack_forget()
            if self.cancel_button:
                self.cancel_button.pack_forget()
                self.cancel_button.configure(state="normal", text="Cancel")
        
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
        self._update_status("Cancelling operation...", color="#FF6B6B")
        if self.cancel_button:
            self.cancel_button.configure(state="disabled", text="Cancelling...")
    
    def _set_url_row_status(self, url: str, status: str, row_list: list):
        """Set visual status for a URL row.
        
        Args:
            url: URL to find and update.
            status: Status - 'processing', 'completed', 'error', or 'default'.
            row_list: List of row widgets to search (bulk_import_rows or poster_scrape_rows).
        """
        def update():
            for row_widgets in row_list:
                if row_widgets['url'].get().strip() == url:
                    if status == 'processing':
                        row_widgets['url'].configure(border_color="#E5A00D", border_width=2)
                    elif status == 'completed':
                        row_widgets['url'].configure(border_color="#00AA00", border_width=2)
                    elif status == 'error':
                        row_widgets['url'].configure(border_color="#FF0000", border_width=2)
                    else:  # default
                        row_widgets['url'].configure(border_color="#484848", border_width=1)
                    break
        
        self.app.after(0, update)
    
    def _clear_url(self):
        """Clear URL entry field."""
        self.url_entry.delete("1.0", ctk.END)
        self._update_status("URLs cleared.", color="orange")
    
    def _set_default_tab(self, tabview):
        """Set default tab based on configuration.
        
        Args:
            tabview: Tabview widget.
        """
        tabview.set("Poster Scrape")
    
    def _load_and_update_ui(self):
        """Load configuration and update UI fields."""
        self.config = self.config_manager.load()
        
        if self.base_url_entry:
            self.base_url_entry.delete(0, ctk.END)
            self.base_url_entry.insert(0, self.config.base_url)
        
        if self.token_entry:
            self.token_entry.delete(0, ctk.END)
            self.token_entry.insert(0, self.config.token)
        
        # Load TV libraries
        if self.tv_library_container:
            for row_widgets in self.tv_library_rows:
                row_widgets['entry'].destroy()
                row_widgets['remove'].destroy()
            self.tv_library_rows.clear()
            
            for library in self.config.tv_library:
                if library.strip():
                    self._add_library_item('tv', library)
            
            # Add one empty row if none exist
            if len(self.tv_library_rows) == 0:
                self._add_library_item('tv')
        
        # Load Movie libraries
        if self.movie_library_container:
            for row_widgets in self.movie_library_rows:
                row_widgets['entry'].destroy()
                row_widgets['remove'].destroy()
            self.movie_library_rows.clear()
            
            for library in self.config.movie_library:
                if library.strip():
                    self._add_library_item('movie', library)
            
            # Add one empty row if none exist
            if len(self.movie_library_rows) == 0:
                self._add_library_item('movie')
        
        # Load Mediux filters
        if self.mediux_filters_container:
            for row_widgets in self.mediux_filters_rows:
                row_widgets['entry'].destroy()
                row_widgets['remove'].destroy()
            self.mediux_filters_rows.clear()
            
            for filter_name in self.config.mediux_filters:
                if filter_name.strip():
                    self._add_library_item('mediux', filter_name)
            
            # Add one empty row if none exist
            if len(self.mediux_filters_rows) == 0:
                self._add_library_item('mediux')
        
        if self.max_workers_var:
            max_workers_value = getattr(self.config, 'max_workers', 3)
            self.max_workers_var.set(max_workers_value)
        
        self._load_bulk_import_file()
        self._load_title_mappings()
        
        # Initialize poster scrape with one empty row if needed
        if self.poster_scrape_scroll and len(self.poster_scrape_rows) == 0:
            self._add_scrape_url_row()
    
    def _save_config(self):
        """Save configuration from UI fields."""
        # Collect TV libraries
        tv_libraries = []
        for row_widgets in self.tv_library_rows:
            value = row_widgets['entry'].get().strip()
            if value:
                tv_libraries.append(value)
        
        # Collect Movie libraries
        movie_libraries = []
        for row_widgets in self.movie_library_rows:
            value = row_widgets['entry'].get().strip()
            if value:
                movie_libraries.append(value)
        
        # Collect Mediux filters
        mediux_filters = []
        for row_widgets in self.mediux_filters_rows:
            value = row_widgets['entry'].get().strip()
            if value:
                mediux_filters.append(value)
        
        new_config = Config(
            base_url=self.base_url_entry.get().strip(),
            token=self.token_entry.get().strip(),
            tv_library=tv_libraries,
            movie_library=movie_libraries,
            mediux_filters=mediux_filters,
            bulk_files=self.config.bulk_files,  # Preserve bulk files list
            title_mappings=self.config.title_mappings,  # Preserve title mappings
            max_workers=self.max_workers_var.get() if self.max_workers_var else 3
        )
        
        if self.config_manager.save(new_config):
            self.config = new_config
            self._load_and_update_ui()
            self._update_status("Configuration saved successfully!", color="#E5A00D")
        else:
            self._update_status("Error saving configuration.", color="red")
    
    def _load_bulk_import_file(self):
        """Load bulk import file content into rows."""
        if not self.bulk_import_scroll:
            return
        
        try:
            # Clear existing rows
            for row_widgets in self.bulk_import_rows:
                row_widgets['url'].destroy()
                row_widgets['remove'].destroy()
            self.bulk_import_rows.clear()
            
            bulk_txt_path = os.path.join(get_exe_dir(), self.current_bulk_file or "bulk_import.txt")
            
            if not os.path.exists(bulk_txt_path):
                # Add one empty row
                self._add_bulk_url_row()
                return
            
            with open(bulk_txt_path, "r", encoding="utf-8") as file:
                lines = file.readlines()
            
            # Filter out empty lines and comments (// or #)
            urls = []
            for line in lines:
                stripped = line.strip()
                if stripped and not stripped.startswith('//') and not stripped.startswith('#'):
                    urls.append(stripped)
            
            if urls:
                for url in urls:
                    self._add_bulk_url_row(url)
            else:
                self._add_bulk_url_row()
        except Exception as e:
            self._update_status(f"Error loading bulk import file: {str(e)}", color="red")
            self._add_bulk_url_row()
    
    def _save_bulk_import_file(self):
        """Save bulk import URLs from rows to file."""
        try:
            bulk_txt_path = os.path.join(get_exe_dir(), self.current_bulk_file or "bulk_import.txt")
            
            # Ensure parent directory exists (only if needed)
            parent_dir = os.path.dirname(bulk_txt_path)
            if parent_dir and not os.path.exists(parent_dir):
                os.makedirs(parent_dir, exist_ok=True)
            
            # Collect URLs from rows
            urls = []
            for row_widgets in self.bulk_import_rows:
                url = row_widgets['url'].get().strip()
                if url:
                    urls.append(url)
            
            with open(bulk_txt_path, "w", encoding="utf-8") as file:
                file.write("\n".join(urls))
            
            self._update_status(f"Bulk import file saved! ({len(urls)} URLs)", color="#E5A00D")
        except Exception as e:
            self._update_status(f"Error saving bulk import file: {str(e)}", color="red")
    
    def _on_bulk_file_changed(self, selected_file: str):
        """Handle bulk file dropdown selection change.
        
        Args:
            selected_file: The newly selected file name.
        """
        # Switch to new file (don't auto-save)
        self.current_bulk_file = selected_file
        self._load_bulk_import_file()
        self._update_status(f"Switched to: {selected_file}", color="#E5A00D")
    
    def _create_new_bulk_file(self):
        """Create a new bulk import file."""
        # Simple dialog to get file name
        dialog = ctk.CTkInputDialog(
            text="Enter new bulk file name:",
            title="New Bulk File"
        )
        new_filename = dialog.get_input()
        
        if new_filename:
            # Ensure it has .txt extension
            if not new_filename.endswith('.txt'):
                new_filename += '.txt'
            
            # Check if it already exists
            if new_filename in self.config.bulk_files:
                self._update_status(f"File {new_filename} already exists!", color="red")
                return
            
            # Check if file already exists on disk
            bulk_txt_path = os.path.join(get_exe_dir(), new_filename)
            if os.path.exists(bulk_txt_path):
                # File exists on disk, add to config and load it
                self.config.bulk_files.append(new_filename)
                self.config_manager.save(self.config)
                
                # Update dropdown
                self.bulk_file_dropdown.configure(values=self.config.bulk_files)
                
                # Switch to existing file and load it
                self.current_bulk_file = new_filename
                self.bulk_file_dropdown.set(new_filename)
                self._load_bulk_import_file()
                
                self._update_status(f"Added existing file: {new_filename}", color="#E5A00D")
                return
            
            # Add to config
            self.config.bulk_files.append(new_filename)
            self.config_manager.save(self.config)
            
            # Update dropdown
            self.bulk_file_dropdown.configure(values=self.config.bulk_files)
            
            # Switch to new file
            self.current_bulk_file = new_filename
            self.bulk_file_dropdown.set(new_filename)
            
            # Clear current rows (new file is empty)
            for row_widgets in self.bulk_import_rows:
                row_widgets['url'].destroy()
                row_widgets['remove'].destroy()
            self.bulk_import_rows.clear()
            self._add_bulk_url_row()
            
            # Create empty file
            with open(bulk_txt_path, "w", encoding="utf-8") as file:
                file.write("")
            
            self._update_status(f"Created new bulk file: {new_filename}", color="#E5A00D")
    
    def _delete_bulk_file(self):
        """Delete the current bulk import file."""
        if not self.current_bulk_file:
            return
        
        if len(self.config.bulk_files) <= 1:
            self._update_status("Cannot delete the last bulk file!", color="red")
            return
        
        # Confirm deletion
        import tkinter.messagebox as messagebox
        result = messagebox.askyesno(
            "Delete Bulk File",
            f"Are you sure you want to delete '{self.current_bulk_file}'?\\n\\nThis will permanently delete the file."
        )
        
        if result:
            try:
                # Delete the file
                bulk_txt_path = os.path.join(get_exe_dir(), self.current_bulk_file)
                if os.path.exists(bulk_txt_path):
                    os.remove(bulk_txt_path)
                
                # Remove from config
                self.config.bulk_files.remove(self.current_bulk_file)
                self.config_manager.save(self.config)
                
                # Update dropdown and switch to first file
                self.bulk_file_dropdown.configure(values=self.config.bulk_files)
                self.current_bulk_file = self.config.bulk_files[0]
                self.bulk_file_dropdown.set(self.current_bulk_file)
                
                # Load the new file
                self._load_bulk_import_file()
                
                self._update_status(f"Deleted bulk file successfully", color="#E5A00D")
            except Exception as e:
                self._update_status(f"Error deleting file: {str(e)}", color="red")
    
    def _load_title_mappings(self):
        """Load title mappings from config into individual rows."""
        if not self.title_mappings_scroll:
            return
        
        try:
            # Clear existing rows
            for row_widgets in self.title_mappings_rows:
                row_widgets['original'].destroy()
                row_widgets['plex'].destroy()
                row_widgets['remove'].destroy()
            self.title_mappings_rows.clear()
            
            # Add rows for existing mappings
            if self.config.title_mappings:
                for original, plex_title in self.config.title_mappings.items():
                    self._add_title_mapping_row(original, plex_title)
            else:
                # Add one empty row to start
                self._add_title_mapping_row()
        except Exception as e:
            self._update_status(f"Error loading title mappings: {str(e)}", color="red")
    
    def _save_title_mappings(self):
        """Save title mappings from individual rows to config."""
        try:
            new_mappings = {}
            
            # Collect data from all rows
            for row_widgets in self.title_mappings_rows:
                original = row_widgets['original'].get().strip()
                plex_title = row_widgets['plex'].get().strip()
                
                # Only add non-empty mappings
                if original and plex_title:
                    new_mappings[original] = plex_title
            
            # Update config with new mappings
            self.config.title_mappings = new_mappings
            
            if self.config_manager.save(self.config):
                self._update_status(f"Title mappings saved! ({len(new_mappings)} entries)", color="#E5A00D")
            else:
                self._update_status("Error saving title mappings.", color="red")
        except Exception as e:
            self._update_status(f"Error saving title mappings: {str(e)}", color="red")
    
    def _add_title_mapping_row(self, original_title="", plex_title=""):
        """Add a new title mapping row with entry fields.
        
        Args:
            original_title: Original title from poster source.
            plex_title: Corresponding title in Plex library.
        """
        row_num = len(self.title_mappings_rows)
        
        # Original title entry
        original_entry = ctk.CTkEntry(
            self.title_mappings_scroll,
            placeholder_text="Original Title",
            fg_color="#2A2B2B",
            text_color="#A1A1A1",
            border_width=1,
            border_color="#484848",
            height=35
        )
        original_entry.grid(row=row_num, column=0, pady=3, padx=(5, 2), sticky="ew")
        if original_title:
            original_entry.insert(0, original_title)
        self._bind_context_menu(original_entry)
        
        # Plex title entry
        plex_entry = ctk.CTkEntry(
            self.title_mappings_scroll,
            placeholder_text="Plex Title",
            fg_color="#2A2B2B",
            text_color="#A1A1A1",
            border_width=1,
            border_color="#484848",
            height=35
        )
        plex_entry.grid(row=row_num, column=1, pady=3, padx=(2, 2), sticky="ew")
        if plex_title:
            plex_entry.insert(0, plex_title)
        self._bind_context_menu(plex_entry)
        
        # Remove button
        remove_button = ctk.CTkButton(
            self.title_mappings_scroll,
            text="✕",
            command=lambda: self._remove_title_mapping_row(row_num),
            width=35,
            height=35,
            fg_color="#8B0000",
            hover_color="#A52A2A",
            text_color="white",
            font=("Roboto", 14, "bold")
        )
        remove_button.grid(row=row_num, column=2, pady=3, padx=(2, 5), sticky="ew")
        
        # Store references to widgets
        self.title_mappings_rows.append({
            'original': original_entry,
            'plex': plex_entry,
            'remove': remove_button,
            'row': row_num
        })
    
    def _remove_title_mapping_row(self, row_num: int):
        """Remove a title mapping row.
        
        Args:
            row_num: Row number to remove.
        """
        try:
            # Find and destroy widgets for this row
            for i, row_widgets in enumerate(self.title_mappings_rows):
                if row_widgets['row'] == row_num:
                    row_widgets['original'].destroy()
                    row_widgets['plex'].destroy()
                    row_widgets['remove'].destroy()
                    self.title_mappings_rows.pop(i)
                    break
            
            # Re-grid remaining rows
            for i, row_widgets in enumerate(self.title_mappings_rows):
                row_widgets['row'] = i
                row_widgets['original'].grid(row=i, column=0, pady=3, padx=(5, 2), sticky="ew")
                row_widgets['plex'].grid(row=i, column=1, pady=3, padx=(2, 2), sticky="ew")
                row_widgets['remove'].configure(command=lambda r=i: self._remove_title_mapping_row(r))
                row_widgets['remove'].grid(row=i, column=2, pady=3, padx=(2, 5), sticky="ew")
            
            self._update_status("Mapping removed.", color="#E5A00D")
        except Exception as e:
            self._update_status(f"Error removing mapping: {str(e)}", color="red")
    
    def _add_library_item(self, list_type: str, value: str = ""):
        """Add a new library item row.
        
        Args:
            list_type: Type of list ('tv', 'movie', or 'mediux').
            value: Value to prepopulate.
        """
        if list_type == 'tv':
            container = self.tv_library_container
            row_list = self.tv_library_rows
            placeholder = "Enter TV library name"
        elif list_type == 'movie':
            container = self.movie_library_container
            row_list = self.movie_library_rows
            placeholder = "Enter movie library name"
        else:  # mediux
            container = self.mediux_filters_container
            row_list = self.mediux_filters_rows
            placeholder = "Enter Mediux filter name"
        
        row_num = len(row_list)
        
        # Entry field
        entry = ctk.CTkEntry(
            container,
            placeholder_text=placeholder,
            fg_color="#2A2B2B",
            text_color="#A1A1A1",
            border_width=1,
            border_color="#484848",
            height=35
        )
        entry.grid(row=row_num, column=0, pady=3, padx=(5, 2), sticky="ew")
        if value:
            entry.insert(0, value)
        self._bind_context_menu(entry)
        
        # Remove button
        remove_button = ctk.CTkButton(
            container,
            text="✕",
            command=lambda: self._remove_library_item(list_type, row_num),
            width=35,
            height=35,
            fg_color="#8B0000",
            hover_color="#A52A2A",
            text_color="white",
            font=("Roboto", 14, "bold")
        )
        remove_button.grid(row=row_num, column=1, pady=3, padx=(2, 5), sticky="ew")
        
        # Store references
        row_list.append({
            'entry': entry,
            'remove': remove_button,
            'row': row_num
        })
    
    def _remove_library_item(self, list_type: str, row_num: int):
        """Remove a library item row.
        
        Args:
            list_type: Type of list ('tv', 'movie', or 'mediux').
            row_num: Row number to remove.
        """
        try:
            if list_type == 'tv':
                row_list = self.tv_library_rows
            elif list_type == 'movie':
                row_list = self.movie_library_rows
            else:  # mediux
                row_list = self.mediux_filters_rows
            
            # Remove the widgets
            for i, row_widgets in enumerate(row_list):
                if row_widgets['row'] == row_num:
                    row_widgets['entry'].destroy()
                    row_widgets['remove'].destroy()
                    row_list.pop(i)
                    break
            
            # Re-grid remaining rows
            for i, row_widgets in enumerate(row_list):
                row_widgets['row'] = i
                row_widgets['entry'].grid(row=i, column=0, pady=3, padx=(5, 2), sticky="ew")
                row_widgets['remove'].configure(command=lambda lt=list_type, r=i: self._remove_library_item(lt, r))
                row_widgets['remove'].grid(row=i, column=1, pady=3, padx=(2, 5), sticky="ew")
        except Exception as e:
            self._update_status(f"Error removing item: {str(e)}", color="red")
    
    def _add_bulk_url_row(self, url=""):
        """Add a new bulk import URL row.
        
        Args:
            url: URL to prepopulate.
        """
        # Check for duplicates
        if url:
            for row_widgets in self.bulk_import_rows:
                existing_url = row_widgets['url'].get().strip()
                if existing_url == url:
                    self._update_status(f"URL already exists: {url}", color="orange")
                    return
        
        row_num = len(self.bulk_import_rows)
        
        # URL entry
        url_entry = ctk.CTkEntry(
            self.bulk_import_scroll,
            placeholder_text="https://mediux.pro/sets/12345 or https://theposterdb.com/set/12345",
            fg_color="#2A2B2B",
            text_color="#A1A1A1",
            border_width=1,
            border_color="#484848",
            height=35
        )
        url_entry.grid(row=row_num, column=0, pady=3, padx=(5, 2), sticky="ew")
        if url:
            url_entry.insert(0, url)
        self._bind_context_menu(url_entry)
        
        # Remove button
        remove_button = ctk.CTkButton(
            self.bulk_import_scroll,
            text="✕",
            command=lambda: self._remove_bulk_url_row(row_num),
            width=35,
            height=35,
            fg_color="#8B0000",
            hover_color="#A52A2A",
            text_color="white",
            font=("Roboto", 14, "bold")
        )
        remove_button.grid(row=row_num, column=1, pady=3, padx=(2, 5), sticky="ew")
        
        # Store references
        self.bulk_import_rows.append({
            'url': url_entry,
            'remove': remove_button,
            'row': row_num
        })
    
    def _remove_bulk_url_row(self, row_num: int):
        """Remove a bulk import URL row."""
        try:
            for i, row_widgets in enumerate(self.bulk_import_rows):
                if row_widgets['row'] == row_num:
                    row_widgets['url'].destroy()
                    row_widgets['remove'].destroy()
                    self.bulk_import_rows.pop(i)
                    break
            
            # Re-grid remaining rows
            for i, row_widgets in enumerate(self.bulk_import_rows):
                row_widgets['row'] = i
                row_widgets['url'].grid(row=i, column=0, pady=3, padx=(5, 2), sticky="ew")
                row_widgets['remove'].configure(command=lambda r=i: self._remove_bulk_url_row(r))
                row_widgets['remove'].grid(row=i, column=1, pady=3, padx=(2, 5), sticky="ew")
            
            # Add one if empty
            if len(self.bulk_import_rows) == 0:
                self._add_bulk_url_row()
        except Exception as e:
            self._update_status(f"Error removing URL: {str(e)}", color="red")
    
    def _add_scrape_url_row(self, url=""):
        """Add a new poster scrape URL row.
        
        Args:
            url: URL to prepopulate.
        """
        # Check for duplicates
        if url:
            for row_widgets in self.poster_scrape_rows:
                existing_url = row_widgets['url'].get().strip()
                if existing_url == url:
                    self._update_status(f"URL already exists: {url}", color="orange")
                    return
        
        row_num = len(self.poster_scrape_rows)
        
        # URL entry
        url_entry = ctk.CTkEntry(
            self.poster_scrape_scroll,
            placeholder_text="https://mediux.pro/sets/12345 or https://theposterdb.com/set/12345",
            fg_color="#2A2B2B",
            text_color="#A1A1A1",
            border_width=1,
            border_color="#484848",
            height=35
        )
        url_entry.grid(row=row_num, column=0, pady=3, padx=(5, 2), sticky="ew")
        if url:
            url_entry.insert(0, url)
        self._bind_context_menu(url_entry)
        
        # Remove button
        remove_button = ctk.CTkButton(
            self.poster_scrape_scroll,
            text="✕",
            command=lambda: self._remove_scrape_url_row(row_num),
            width=35,
            height=35,
            fg_color="#8B0000",
            hover_color="#A52A2A",
            text_color="white",
            font=("Roboto", 14, "bold")
        )
        remove_button.grid(row=row_num, column=1, pady=3, padx=(2, 5), sticky="ew")
        
        # Store references
        self.poster_scrape_rows.append({
            'url': url_entry,
            'remove': remove_button,
            'row': row_num
        })
    
    def _remove_scrape_url_row(self, row_num: int):
        """Remove a poster scrape URL row."""
        try:
            for i, row_widgets in enumerate(self.poster_scrape_rows):
                if row_widgets['row'] == row_num:
                    row_widgets['url'].destroy()
                    row_widgets['remove'].destroy()
                    self.poster_scrape_rows.pop(i)
                    break
            
            # Re-grid remaining rows
            for i, row_widgets in enumerate(self.poster_scrape_rows):
                row_widgets['row'] = i
                row_widgets['url'].grid(row=i, column=0, pady=3, padx=(5, 2), sticky="ew")
                row_widgets['remove'].configure(command=lambda r=i: self._remove_scrape_url_row(r))
                row_widgets['remove'].grid(row=i, column=1, pady=3, padx=(2, 5), sticky="ew")
            
            # Add one if empty
            if len(self.poster_scrape_rows) == 0:
                self._add_scrape_url_row()
        except Exception as e:
            self._update_status(f"Error removing URL: {str(e)}", color="red")
    
    def _clear_scrape_urls(self):
        """Clear all poster scrape URLs."""
        for row_widgets in self.poster_scrape_rows:
            row_widgets['url'].destroy()
            row_widgets['remove'].destroy()
        self.poster_scrape_rows.clear()
        self._add_scrape_url_row()
        self._update_status("All URLs cleared.", color="orange")
    
    def _run_url_scrape_thread(self):
        """Run URL scrape in separate thread."""
        # Collect URLs from rows
        urls = [row['url'].get().strip() for row in self.poster_scrape_rows if row['url'].get().strip()]
        
        if not urls:
            self._update_status("Please enter at least one valid URL.", color="red")
            return
            return
        
        self._disable_buttons()
        threading.Thread(target=self._process_scrape_urls, args=(urls,)).start()
    
    def _run_bulk_import_thread(self):
        """Run bulk import in separate thread."""
        # Collect URLs from rows, filter out empty and comments
        urls = []
        for row in self.bulk_import_rows:
            url = row['url'].get().strip()
            if url and not url.startswith('//') and not url.startswith('#'):
                urls.append(url)
        
        if not urls:
            self._update_status("No URLs found. Add at least one URL to import.", color="red")
            return
        
        self._disable_buttons()
        threading.Thread(target=self._process_bulk_import, args=(urls,)).start()
    
    def _process_scrape_urls(self, urls: List[str]):
        """Process multiple URLs with concurrent scraping.
        
        Args:
            urls: List of URLs to scrape.
        """
        try:
            self._setup_services()
            
            if not self.plex_service.tv_libraries and not self.plex_service.movie_libraries:
                self._update_status("Plex setup incomplete. Please configure your settings.", color="red")
                self._hide_progress()
                return
            
            total_urls = len(urls)
            max_workers = self.max_workers_var.get() if self.max_workers_var else 3
            
            self.is_cancelled = False
            self._update_status(f"Scraping {total_urls} URL(s) with {max_workers} worker(s)...", color="#E5A00D")
            self._update_progress(0, total_urls, active_count=max_workers)
            self._show_cancel_button()
            
            # Use ThreadPoolExecutor for concurrent scraping
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                self.active_executor = executor
                # Submit all URL scraping tasks
                future_to_url = {executor.submit(self._scrape_single_url, url): url for url in urls}
                
                # Mark initial batch as processing
                initial_batch = min(max_workers, total_urls)
                for i in range(initial_batch):
                    self._set_url_row_status(urls[i], 'processing', self.poster_scrape_rows)
                
                completed = 0
                
                for future in as_completed(future_to_url):
                    if self.is_cancelled:
                        # Cancel all pending futures immediately
                        for f in future_to_url:
                            if not f.done():
                                f.cancel()
                        self._update_status(f"Operation cancelled. Processed {completed}/{total_urls} URLs.", color="#FF6B6B")
                        # Exit the with block to trigger executor shutdown
                        break
                    
                    url = future_to_url[future]
                    
                    # Calculate remaining active workers
                    remaining = total_urls - completed - 1
                    active_workers = min(remaining, max_workers)
                    
                    try:
                        movie_posters, show_posters, collection_posters = future.result()
                        
                        # Upload posters
                        for poster in collection_posters:
                            self.upload_service.process_poster(poster)
                        
                        for poster in movie_posters:
                            self.upload_service.process_poster(poster)
                        
                        for poster in show_posters:
                            self.upload_service.process_poster(poster)
                        
                        self._set_url_row_status(url, 'completed', self.poster_scrape_rows)
                        completed += 1
                        
                        # Mark next URL as processing if there are more
                        next_index = completed + max_workers - 1
                        if next_index < total_urls:
                            self._set_url_row_status(urls[next_index], 'processing', self.poster_scrape_rows)
                        
                        self._update_progress(completed, total_urls, url, active_workers)
                        
                    except Exception as e:
                        self._set_url_row_status(url, 'error', self.poster_scrape_rows)
                        completed += 1
                        
                        # Still mark next URL as processing
                        next_index = completed + max_workers - 1
                        if next_index < total_urls:
                            self._set_url_row_status(urls[next_index], 'processing', self.poster_scrape_rows)
                        
                        remaining = total_urls - completed
                        active_workers = min(remaining, max_workers)
                        self._update_progress(completed, total_urls, url, active_workers)
            
            self.active_executor = None
            if not self.is_cancelled:
                self._update_status(f"All {total_urls} URL(s) processed successfully!", color="#E5A00D")
            self._hide_progress()
        
        except Exception as e:
            self._hide_progress()
            self._update_status(f"Error: {e}", color="red")
        
        finally:
            self._enable_buttons()
    
    def _scrape_single_url(self, url: str):
        """Scrape a single URL and return poster lists.
        
        Args:
            url: URL to scrape.
            
        Returns:
            Tuple of (movie_posters, show_posters, collection_posters)
        """
        return self.scraper_factory.scrape_url(url)
    
    def _process_bulk_import(self, valid_urls: List[str]):
        """Process bulk import URLs with concurrent processing.
        
        Args:
            valid_urls: List of URLs to process.
        """
        try:
            self._setup_services()
            
            if not self.plex_service.tv_libraries and not self.plex_service.movie_libraries:
                self._update_status("Plex setup incomplete. Please configure your settings.", color="red")
                self._hide_progress()
                return
            
            total_urls = len(valid_urls)
            max_workers = self.max_workers_var.get() if self.max_workers_var else 3
            
            self.is_cancelled = False
            self._update_status(f"Bulk importing {total_urls} URL(s) with {max_workers} worker(s)...", color="#E5A00D")
            self._update_progress(0, total_urls, active_count=max_workers)
            self._show_cancel_button()
            
            # Use ThreadPoolExecutor for concurrent processing
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                self.active_executor = executor
                future_to_url = {executor.submit(self._scrape_single_url, url): url for url in valid_urls}
                
                # Mark initial batch as processing
                initial_batch = min(max_workers, total_urls)
                for i in range(initial_batch):
                    self._set_url_row_status(valid_urls[i], 'processing', self.bulk_import_rows)
                
                completed = 0
                
                for future in as_completed(future_to_url):
                    if self.is_cancelled:
                        # Cancel all pending futures immediately
                        for f in future_to_url:
                            if not f.done():
                                f.cancel()
                        self._update_status(f"Operation cancelled. Processed {completed}/{total_urls} URLs.", color="#FF6B6B")
                        # Exit the with block to trigger executor shutdown
                        break
                    
                    url = future_to_url[future]
                    
                    # Calculate remaining active workers
                    remaining = total_urls - completed - 1
                    active_workers = min(remaining, max_workers)
                    
                    try:
                        movie_posters, show_posters, collection_posters = future.result()
                        
                        for poster in collection_posters:
                            self.upload_service.process_poster(poster)
                        
                        for poster in movie_posters:
                            self.upload_service.process_poster(poster)
                        
                        for poster in show_posters:
                            self.upload_service.process_poster(poster)
                        
                        self._set_url_row_status(url, 'completed', self.bulk_import_rows)
                        completed += 1
                        
                        # Mark next URL as processing if there are more
                        next_index = completed + max_workers - 1
                        if next_index < total_urls:
                            self._set_url_row_status(valid_urls[next_index], 'processing', self.bulk_import_rows)
                        
                        self._update_progress(completed, total_urls, url, active_workers)
                        
                    except Exception as e:
                        self._set_url_row_status(url, 'error', self.bulk_import_rows)
                        completed += 1
                        
                        # Still mark next URL as processing
                        next_index = completed + max_workers - 1
                        if next_index < total_urls:
                            self._set_url_row_status(valid_urls[next_index], 'processing', self.bulk_import_rows)
                        
                        remaining = total_urls - completed
                        active_workers = min(remaining, max_workers)
                        self._update_progress(completed, total_urls, url, active_workers)
            
            self.active_executor = None
            if not self.is_cancelled:
                self._update_status(f"Bulk import completed! Processed {total_urls} URL(s).", color="#E5A00D")
            self._hide_progress()
        
        except Exception as e:
            self._hide_progress()
            self._update_status(f"Error during bulk import: {e}", color="red")
        
        finally:
            self._enable_buttons()
    
    def _setup_services(self):
        """Setup Plex and scraper services."""
        self.plex_service = PlexService(self.config)
        self.plex_service.setup(gui_mode=True)
        
        self.upload_service = PosterUploadService(self.plex_service)
        self.scraper_factory = ScraperFactory(self.config, use_playwright=True)
    
    def _disable_buttons(self):
        """Disable action buttons during processing."""
        self.app.after(0, lambda: [
            self.scrape_button.configure(state="disabled"),
            self.clear_button.configure(state="disabled"),
            self.bulk_import_button.configure(state="disabled"),
            self.add_bulk_url_button.configure(state="disabled"),
            self.add_scrape_url_button.configure(state="disabled"),
        ])
    
    def _enable_buttons(self):
        """Enable action buttons after processing."""
        self.app.after(0, lambda: [
            self.scrape_button.configure(state="normal"),
            self.clear_button.configure(state="normal"),
            self.bulk_import_button.configure(state="normal"),
            self.add_bulk_url_button.configure(state="normal"),
            self.add_scrape_url_button.configure(state="normal"),
        ])
