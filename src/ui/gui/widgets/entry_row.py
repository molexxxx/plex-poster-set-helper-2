"""Reusable entry row widget with delete button."""

import customtkinter as ctk


class EntryRow:
    """A row with an entry field and delete button."""
    
    def __init__(self, parent, placeholder="", on_delete=None, initial_value="", ui_helpers=None):
        """Initialize entry row.
        
        Args:
            parent: Parent widget.
            placeholder: Placeholder text for entry.
            on_delete: Callback function when delete is clicked.
            initial_value: Initial value for entry.
            ui_helpers: UIHelpers instance for context menu.
        """
        self.frame = ctk.CTkFrame(parent, fg_color="transparent")
        self.on_delete = on_delete
        
        self.frame.grid_columnconfigure(0, weight=1)
        
        self.entry = ctk.CTkEntry(
            self.frame,
            placeholder_text=placeholder,
            fg_color="#2A2B2B",
            border_width=1,
            border_color="#484848",
            text_color="#CECECE",
            height=35
        )
        self.entry.grid(row=0, column=0, padx=(0, 5), sticky="ew")
        
        if ui_helpers:
            ui_helpers.bind_context_menu(self.entry)
        
        if initial_value:
            self.entry.insert(0, initial_value)
        
        self.delete_button = ctk.CTkButton(
            self.frame,
            text="✕",
            command=self._on_delete_clicked,
            fg_color="#8B0000",
            hover_color="#A52A2A",
            border_width=1,
            border_color="#484848",
            text_color="#FFFFFF",
            width=35,
            height=35,
            font=("Roboto", 13, "bold")
        )
        self.delete_button.grid(row=0, column=1, padx=0, sticky="e")
    
    def _on_delete_clicked(self):
        """Handle delete button click."""
        if self.on_delete:
            self.on_delete()
    
    def grid(self, **kwargs):
        """Grid the frame."""
        self.frame.grid(**kwargs)
    
    def destroy(self):
        """Destroy the frame."""
        self.frame.destroy()
    
    def get(self):
        """Get entry value."""
        return self.entry.get().strip()
    
    def set_delete_callback(self, callback):
        """Update delete callback."""
        self.on_delete = callback
        self.delete_button.configure(command=self._on_delete_clicked)
