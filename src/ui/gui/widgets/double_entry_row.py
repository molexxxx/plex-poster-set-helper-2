"""Reusable double entry row for key-value pairs."""

import customtkinter as ctk


class DoubleEntryRow:
    """A row with two entry fields and a delete button."""
    
    def __init__(self, parent, placeholder1="", placeholder2="", on_delete=None, 
                 initial_value1="", initial_value2="", ui_helpers=None):
        """Initialize double entry row.
        
        Args:
            parent: Parent widget.
            placeholder1: Placeholder for first entry.
            placeholder2: Placeholder for second entry.
            on_delete: Callback function when delete is clicked.
            initial_value1: Initial value for first entry.
            initial_value2: Initial value for second entry.
            ui_helpers: UIHelpers instance for context menu.
        """
        self.frame = ctk.CTkFrame(parent, fg_color="transparent")
        self.on_delete = on_delete
        
        self.frame.grid_columnconfigure(0, weight=1)
        self.frame.grid_columnconfigure(1, weight=1)
        
        # First entry
        self.entry1 = ctk.CTkEntry(
            self.frame,
            placeholder_text=placeholder1,
            fg_color="#2A2B2B",
            border_width=1,
            border_color="#484848",
            text_color="#CECECE",
            height=35
        )
        self.entry1.grid(row=0, column=0, padx=(0, 5), sticky="ew")
        
        if ui_helpers:
            ui_helpers.bind_context_menu(self.entry1)
        
        if initial_value1:
            self.entry1.insert(0, initial_value1)
        
        # Second entry
        self.entry2 = ctk.CTkEntry(
            self.frame,
            placeholder_text=placeholder2,
            fg_color="#2A2B2B",
            border_width=1,
            border_color="#484848",
            text_color="#CECECE",
            height=35
        )
        self.entry2.grid(row=0, column=1, padx=(0, 5), sticky="ew")
        
        if ui_helpers:
            ui_helpers.bind_context_menu(self.entry2)
        
        if initial_value2:
            self.entry2.insert(0, initial_value2)
        
        # Delete button
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
        self.delete_button.grid(row=0, column=2, padx=0, sticky="e")
    
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
        """Get both entry values as tuple.
        
        Returns:
            Tuple of (first_value, second_value).
        """
        return (self.entry1.get().strip(), self.entry2.get().strip())
    
    def set_delete_callback(self, callback):
        """Update delete callback."""
        self.on_delete = callback
        self.delete_button.configure(command=self._on_delete_clicked)
