"""Title Mappings tab for managing poster-to-Plex title mappings."""

import customtkinter as ctk
from ..widgets import DoubleEntryRow


class TitleMappingsTab:
    """Manages the Title Mappings tab interface."""
    
    def __init__(self, parent, app):
        """Initialize Title Mappings tab.
        
        Args:
            parent: Parent tab view widget.
            app: Main application instance.
        """
        self.app = app
        self.tab = parent.add("Title Mappings")
        self.scroll_frame = None
        self.rows = []
        
        self._create_ui()
    
    def _create_ui(self):
        """Create the tab UI."""
        self.tab.grid_columnconfigure(0, weight=1)
        
        info_label = ctk.CTkLabel(
            self.tab,
            text="Map poster titles to your Plex library titles",
            text_color="#696969",
            font=("Roboto", 15)
        )
        info_label.grid(row=0, column=0, pady=5, padx=5, sticky="w")
        
        # Column headers frame
        headers_frame = ctk.CTkFrame(self.tab, fg_color="transparent")
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
        self.scroll_frame = self.app.ui_helpers.create_scrollable_frame(self.tab)
        self.scroll_frame.grid(row=2, column=0, padx=10, pady=(0, 5), sticky="nsew")
        self.scroll_frame.grid_columnconfigure(0, weight=1)
        self.scroll_frame.grid_columnconfigure(1, weight=1)
        self.scroll_frame.grid_columnconfigure(2, weight=0)
        
        self.tab.grid_rowconfigure(2, weight=1)
        
        button_frame = ctk.CTkFrame(self.tab, fg_color="transparent")
        button_frame.grid(row=3, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=0)
        button_frame.grid_columnconfigure(1, weight=1)
        button_frame.grid_columnconfigure(2, weight=0)
        
        add_button = self.app.ui_helpers.create_button(
            button_frame, text="Add Mapping", command=self.add_mapping_row)
        add_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="ew")
        
        save_button = self.app.ui_helpers.create_button(
            button_frame, text="Save All", command=self.save_mappings, primary=True)
        save_button.grid(row=0, column=1, pady=0, padx=5, sticky="ew")
        
        reload_button = self.app.ui_helpers.create_button(
            button_frame, text="Reload", command=self.load_mappings)
        reload_button.grid(row=0, column=2, pady=0, padx=5, ipadx=30, sticky="ew")
    
    def add_mapping_row(self, original_title="", plex_title=""):
        """Add a title mapping row."""
        row_num = len(self.rows)
        
        mapping_row = DoubleEntryRow(
            self.scroll_frame,
            placeholder1="Poster title",
            placeholder2="Plex library title",
            initial_value1=original_title,
            initial_value2=plex_title,
            on_delete=lambda: self.remove_mapping_row(row_num),
            ui_helpers=self.app.ui_helpers
        )
        mapping_row.grid(row=row_num, column=0, columnspan=3, padx=0, pady=2, sticky="ew")
        
        self.rows.append(mapping_row)
    
    def remove_mapping_row(self, row_num: int):
        """Remove a mapping row or clear text if at minimum."""
        if 0 <= row_num < len(self.rows):
            # If at minimum (1 row), just clear the text instead of deleting
            if len(self.rows) <= 1:
                self.rows[row_num].entry1.delete(0, 'end')
                self.rows[row_num].entry2.delete(0, 'end')
            else:
                self.rows[row_num].destroy()
                self.rows.pop(row_num)
                
                # Reindex remaining rows
                for idx, row in enumerate(self.rows):
                    row.grid(row=idx, column=0, columnspan=3, padx=0, pady=2, sticky="ew")
                    row.set_delete_callback(lambda r=idx: self.remove_mapping_row(r))
    
    def load_mappings(self):
        """Load title mappings from config."""
        for row in self.rows:
            row.destroy()
        self.rows.clear()
        
        for original, plex in self.app.config.title_mappings.items():
            self.add_mapping_row(original, plex)
        
        if not self.rows:
            self.add_mapping_row()
        
        self.app._update_status(f"Loaded {len(self.app.config.title_mappings)} title mapping(s)", color="#E5A00D")
    
    def save_mappings(self):
        """Save title mappings to config."""
        new_mappings = {}
        
        for row in self.rows:
            original, plex = row.get()
            original = original.strip()
            plex = plex.strip()
            
            if original and plex:
                new_mappings[original] = plex
        
        self.app.config.title_mappings = new_mappings
        self.app.config_manager.save(self.app.config)
        
        self.app._update_status(f"Saved {len(new_mappings)} title mapping(s)", color="#E5A00D")
