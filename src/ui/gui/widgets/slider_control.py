"""Reusable slider control with label and value display."""

import tkinter as tk
import customtkinter as ctk


class SliderControl:
    """A labeled slider with value display."""
    
    def __init__(self, parent, label_text, default_value=0.0, min_value=0.0, 
                 max_value=1.0, steps=10, show_unit=True, unit_text="sec"):
        """Initialize slider control.
        
        Args:
            parent: Parent widget.
            label_text: Label text for the slider.
            default_value: Default slider value.
            min_value: Minimum slider value.
            max_value: Maximum slider value.
            steps: Number of steps in slider.
            show_unit: Whether to show unit label.
            unit_text: Unit text to display.
        """
        self.frame = ctk.CTkFrame(parent, fg_color="transparent")
        self.frame.grid_columnconfigure(1, weight=1)
        
        # Label
        label = ctk.CTkLabel(
            self.frame,
            text=label_text,
            text_color="#696969",
            font=("Roboto", 13)
        )
        label.grid(row=0, column=0, pady=0, padx=(0, 10), sticky="w")
        
        # Variable
        if isinstance(default_value, int):
            self.var = tk.IntVar(value=default_value)
        else:
            self.var = tk.DoubleVar(value=default_value)
        
        # Slider
        self.slider = ctk.CTkSlider(
            self.frame,
            from_=min_value,
            to=max_value,
            number_of_steps=steps,
            variable=self.var,
            fg_color="#1C1E1E",
            progress_color="#E5A00D",
            button_color="#E5A00D",
            button_hover_color="#FFA500"
        )
        self.slider.grid(row=0, column=1, pady=0, padx=0, sticky="ew")
        
        # Value display
        value_label = ctk.CTkLabel(
            self.frame,
            textvariable=self.var,
            text_color="#E5A00D",
            font=("Roboto", 13, "bold"),
            width=50
        )
        value_label.grid(row=0, column=2, pady=0, padx=(10, 0), sticky="e")
        
        # Unit label
        if show_unit:
            unit_label = ctk.CTkLabel(
                self.frame,
                text=unit_text,
                text_color="#696969",
                font=("Roboto", 11)
            )
            unit_label.grid(row=0, column=3, pady=0, padx=(2, 0), sticky="w")
    
    def grid(self, **kwargs):
        """Grid the frame."""
        self.frame.grid(**kwargs)
    
    def get(self):
        """Get slider value."""
        return self.var.get()
    
    def set(self, value):
        """Set slider value."""
        self.var.set(value)
