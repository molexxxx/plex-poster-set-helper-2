"""Poster Scrape tab for quick URL scraping."""

import customtkinter as ctk
from ..widgets import DynamicList


class PosterScrapeTab:
    """Manages the Poster Scrape tab interface."""
    
    def __init__(self, parent, app):
        """Initialize Poster Scrape tab.
        
        Args:
            parent: Parent tab view widget.
            app: Main application instance.
        """
        self.app = app
        self.tab = parent.add("Poster Scrape")
        self.scroll_frame = None
        self.url_list = None
        self.scrape_button = None
        self.clear_button = None
        self.add_url_button = None
        
        self._create_ui()
    
    def _create_ui(self):
        """Create the tab UI."""
        self.tab.grid_columnconfigure(0, weight=1)
        
        url_label = ctk.CTkLabel(
            self.tab,
            text="Quick poster scraping - Supports ThePosterDB sets, MediUX sets, or ThePosterDB user URLs",
            text_color="#696969",
            font=("Roboto", 15)
        )
        url_label.grid(row=0, column=0, pady=5, padx=5, sticky="w")
        
        # Scrollable frame for URLs
        self.scroll_frame = self.app.ui_helpers.create_scrollable_frame(self.tab)
        self.scroll_frame.grid(row=1, column=0, padx=10, pady=5, sticky="nsew")
        self.scroll_frame.grid_columnconfigure(0, weight=1)
        
        self.tab.grid_rowconfigure(1, weight=1)
        
        # Create dynamic list for URLs
        self.url_list = DynamicList(
            self.scroll_frame,
            self.app.ui_helpers,
            placeholder="Enter poster URL (ThePosterDB or MediUX)",
            minimum_rows=1
        )
        
        # Add initial row
        self.url_list.add_row()
        
        button_frame = ctk.CTkFrame(self.tab, fg_color="transparent")
        button_frame.grid(row=2, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=0)
        button_frame.grid_columnconfigure(1, weight=0)
        button_frame.grid_columnconfigure(2, weight=1)
        
        self.add_url_button = self.app.ui_helpers.create_button(
            button_frame, text="Add URL", command=self.add_url_row)
        self.add_url_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="ew")
        
        self.clear_button = self.app.ui_helpers.create_button(
            button_frame, text="Clear All", command=self.clear_urls)
        self.clear_button.grid(row=0, column=1, pady=0, padx=5, ipadx=15, sticky="ew")
        
        self.scrape_button = self.app.ui_helpers.create_button(
            button_frame,
            text="Run Scrape",
            command=self.app._run_url_scrape_thread,
            primary=True
        )
        self.scrape_button.grid(row=0, column=2, pady=0, padx=5, sticky="ew")
    
    def add_url_row(self, url=""):
        """Add a URL input row."""
        self.url_list.add_row(url)
    
    def clear_urls(self):
        """Clear all URL rows (resets to one empty row)."""
        self.url_list.clear()
        self.app._update_status("URLs cleared.", color="orange")
    
    def get_urls(self):
        """Get all entered URLs."""
        return self.url_list.get_values()
    
    @property
    def rows(self):
        """Get rows list for backwards compatibility."""
        return [{'entry': row.entry, 'frame': row.frame} for row in self.url_list.rows]
