"""Bulk Import tab for managing and running bulk imports."""

import os
import customtkinter as ctk
from ....utils.helpers import get_exe_dir
from ..widgets import DynamicList


class BulkImportTab:
    """Manages the Bulk Import tab interface."""
    
    def __init__(self, parent, app):
        """Initialize Bulk Import tab.
        
        Args:
            parent: Parent tab view widget.
            app: Main application instance.
        """
        self.app = app
        self.tab = parent.add("Bulk Import")
        self.scroll_frame = None
        self.url_list = None
        self.file_dropdown = None
        self.add_url_button = None
        self.import_button = None
        
        self._create_ui()
    
    def _create_ui(self):
        """Create the tab UI."""
        self.tab.grid_columnconfigure(0, weight=1)
        
        # File selection header
        file_selection_frame = ctk.CTkFrame(self.tab, fg_color="transparent")
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
        if not self.app.current_bulk_file and self.app.config.bulk_files:
            self.app.current_bulk_file = self.app.config.bulk_files[0]
        
        self.file_dropdown = ctk.CTkOptionMenu(
            file_selection_frame,
            values=self.app.config.bulk_files if self.app.config.bulk_files else ["bulk_import.txt"],
            command=self.on_file_changed,
            fg_color="#1C1E1E",
            button_color="#484848",
            button_hover_color="#696969",
            dropdown_fg_color="#2A2B2B",
            text_color="#E5A00D",
            font=("Roboto", 13)
        )
        self.file_dropdown.grid(row=0, column=1, padx=5, sticky="ew")
        self.file_dropdown.set(self.app.current_bulk_file or "bulk_import.txt")
        
        new_file_button = self.app.ui_helpers.create_button(
            file_selection_frame, text="New File", command=self.create_new_file)
        new_file_button.grid(row=0, column=2, padx=5, ipadx=10, sticky="ew")
        
        delete_file_button = self.app.ui_helpers.create_button(
            file_selection_frame, text="Delete File", command=self.delete_file)
        delete_file_button.grid(row=0, column=3, padx=5, ipadx=10, sticky="ew")
        
        info_label = ctk.CTkLabel(
            self.tab,
            text="Bulk import multiple poster URLs",
            text_color="#696969",
            font=("Roboto", 13)
        )
        info_label.grid(row=1, column=0, pady=(0, 5), padx=5, sticky="w")
        
        # Scrollable frame for URLs
        self.scroll_frame = self.app.ui_helpers.create_scrollable_frame(self.tab)
        self.scroll_frame.grid(row=2, column=0, padx=10, pady=5, sticky="nsew")
        self.scroll_frame.grid_columnconfigure(0, weight=1)
        
        self.tab.grid_rowconfigure(2, weight=1)
        
        # Create dynamic list for URLs
        self.url_list = DynamicList(
            self.scroll_frame,
            self.app.ui_helpers,
            placeholder="Enter poster URL",
            minimum_rows=1
        )
        
        button_frame = ctk.CTkFrame(self.tab, fg_color="transparent")
        button_frame.grid(row=3, column=0, pady=5, padx=5, sticky="ew")
        button_frame.grid_columnconfigure(0, weight=0)
        button_frame.grid_columnconfigure(1, weight=0)
        button_frame.grid_columnconfigure(2, weight=1)
        button_frame.grid_columnconfigure(3, weight=0)
        
        self.add_url_button = self.app.ui_helpers.create_button(
            button_frame, text="Add URL", command=self.add_url_row)
        self.add_url_button.grid(row=0, column=0, pady=0, padx=5, ipadx=15, sticky="ew")
        
        reload_button = self.app.ui_helpers.create_button(
            button_frame, text="Reload File", command=self.load_file)
        reload_button.grid(row=0, column=1, pady=0, padx=5, ipadx=15, sticky="ew")
        
        save_button = self.app.ui_helpers.create_button(
            button_frame, text="Save Changes", command=self.save_file)
        save_button.grid(row=0, column=2, pady=0, padx=5, sticky="ew")
        
        self.import_button = self.app.ui_helpers.create_button(
            button_frame,
            text="Run Bulk Import",
            command=self.app._run_bulk_import_thread,
            primary=True
        )
        self.import_button.grid(row=0, column=3, pady=0, padx=5, ipadx=15, sticky="ew")
    
    def add_url_row(self, url=""):
        """Add a URL input row."""
        self.url_list.add_row(url)
    
    def get_urls(self):
        """Get all entered URLs."""
        return self.url_list.get_values()
    
    def load_file(self):
        """Load the current bulk import file."""
        if not self.app.current_bulk_file:
            return
        
        file_path = os.path.join(get_exe_dir(), self.app.current_bulk_file)
        
        try:
            if os.path.exists(file_path):
                with open(file_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                
                urls = [line.strip() for line in lines if line.strip() and not line.strip().startswith('#')]
                self.url_list.set_values(urls)
                
                self.app._update_status(f"Loaded {len(urls)} URLs from {self.app.current_bulk_file}", color="#E5A00D")
            else:
                self.app._update_status(f"File not found: {self.app.current_bulk_file}", color="orange")
        except Exception as e:
            self.app._update_status(f"Error loading file: {str(e)}", color="red")
    
    def save_file(self):
        """Save URLs to the current bulk import file."""
        if not self.app.current_bulk_file:
            return
        
        file_path = os.path.join(get_exe_dir(), self.app.current_bulk_file)
        
        try:
            urls = self.get_urls()
            
            with open(file_path, 'w', encoding='utf-8') as f:
                for url in urls:
                    f.write(f"{url}\n")
            
            self.app._update_status(f"Saved {len(urls)} URLs to {self.app.current_bulk_file}", color="#E5A00D")
        except Exception as e:
            self.app._update_status(f"Error saving file: {str(e)}", color="red")
    
    def on_file_changed(self, selected_file: str):
        """Handle bulk file selection change."""
        self.app.current_bulk_file = selected_file
        self.load_file()
    
    def create_new_file(self):
        """Create a new bulk import file."""
        dialog = ctk.CTkInputDialog(
            text="Enter filename (without extension):",
            title="New Bulk File"
        )
        filename = dialog.get_input()
        
        if filename:
            if not filename.endswith('.txt'):
                filename = f"{filename}.txt"
            
            file_path = os.path.join(get_exe_dir(), filename)
            
            if os.path.exists(file_path):
                self.app._update_status(f"File already exists: {filename}", color="orange")
                return
            
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write("# Bulk import file\n")
                
                if filename not in self.app.config.bulk_files:
                    self.app.config.bulk_files.append(filename)
                    self.app.config_manager.save(self.app.config)
                
                self.file_dropdown.configure(values=self.app.config.bulk_files)
                self.file_dropdown.set(filename)
                self.app.current_bulk_file = filename
                
                self.load_file()
                self.app._update_status(f"Created new file: {filename}", color="#E5A00D")
            except Exception as e:
                self.app._update_status(f"Error creating file: {str(e)}", color="red")
    
    def delete_file(self):
        """Delete the current bulk import file."""
        import tkinter.messagebox as messagebox
        
        if not self.app.current_bulk_file:
            return
        
        result = messagebox.askyesno(
            "Confirm Delete",
            f"Delete {self.app.current_bulk_file}?",
            parent=self.app.app
        )
        
        if result:
            file_path = os.path.join(get_exe_dir(), self.app.current_bulk_file)
            
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                
                if self.app.current_bulk_file in self.app.config.bulk_files:
                    self.app.config.bulk_files.remove(self.app.current_bulk_file)
                    self.app.config_manager.save(self.app.config)
                
                if self.app.config.bulk_files:
                    self.app.current_bulk_file = self.app.config.bulk_files[0]
                else:
                    self.app.current_bulk_file = "bulk_import.txt"
                    self.app.config.bulk_files = ["bulk_import.txt"]
                
                self.file_dropdown.configure(values=self.app.config.bulk_files)
                self.file_dropdown.set(self.app.current_bulk_file)
                
                self.load_file()
                self.app._update_status(f"Deleted file successfully", color="#E5A00D")
            except Exception as e:
                self.app._update_status(f"Error deleting file: {str(e)}", color="red")
    
    @property
    def rows(self):
        """Get rows list for backwards compatibility."""
        return [{'entry': row.entry, 'frame': row.frame} for row in self.url_list.rows]
