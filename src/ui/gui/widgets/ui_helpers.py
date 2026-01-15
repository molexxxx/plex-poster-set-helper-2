"""UI helper methods for creating widgets and managing UI elements."""

import tkinter as tk
import customtkinter as ctk


class UIHelpers:
    """Helper class for creating and managing UI widgets."""
    
    def __init__(self, app):
        """Initialize UI helpers.
        
        Args:
            app: Main application window.
        """
        self.app = app
        self.global_context_menu = None
        self._create_context_menu()
    
    def _create_context_menu(self):
        """Create right-click context menu."""
        self.global_context_menu = tk.Menu(self.app, tearoff=0)
        self.global_context_menu.add_command(label="Cut")
        self.global_context_menu.add_command(label="Copy")
        self.global_context_menu.add_command(label="Paste")
    
    def create_button(self, container, text: str, command, color: str = None, 
                      primary: bool = False, height: int = 35) -> ctk.CTkButton:
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
            button_text_color = "#2A2B2B"
        
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
    
    def bind_context_menu(self, widget):
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
    
    def create_form_row(self, parent, row: int, label_text: str, placeholder: str) -> ctk.CTkEntry:
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
        self.bind_context_menu(entry)
        
        return entry
    
    def create_scrollable_frame(self, parent, **kwargs):
        """Create a scrollable frame with standard styling.
        
        Args:
            parent: Parent widget.
            **kwargs: Additional arguments for CTkScrollableFrame.
            
        Returns:
            Scrollable frame widget.
        """
        defaults = {
            'fg_color': '#1C1E1E',
            'scrollbar_button_color': '#484848',
            'scrollbar_button_hover_color': '#696969'
        }
        defaults.update(kwargs)
        
        return ctk.CTkScrollableFrame(parent, **defaults)
