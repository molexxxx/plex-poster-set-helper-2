"""Dynamic list widget for managing collections of items."""

import customtkinter as ctk
from .entry_row import EntryRow


class DynamicList:
    """Manages a dynamic list of entry rows with add/remove functionality."""
    
    def __init__(self, parent, ui_helpers, placeholder="Enter value", minimum_rows=0):
        """Initialize dynamic list.
        
        Args:
            parent: Parent container widget.
            ui_helpers: UIHelpers instance for styling.
            placeholder: Placeholder text for entries.
            minimum_rows: Minimum number of rows to maintain (0 = no minimum).
        """
        self.parent = parent
        self.ui_helpers = ui_helpers
        self.placeholder = placeholder
        self.minimum_rows = minimum_rows
        self.rows = []
    
    def add_row(self, value=""):
        """Add a new row to the list.
        
        Args:
            value: Initial value for the row.
        """
        row_num = len(self.rows)
        
        entry_row = EntryRow(
            self.parent,
            placeholder=self.placeholder,
            on_delete=lambda r=row_num: self.remove_row(r),
            initial_value=value,
            ui_helpers=self.ui_helpers
        )
        entry_row.grid(row=row_num, column=0, columnspan=2, padx=0, pady=2, sticky="ew")
        
        self.rows.append(entry_row)
    
    def remove_row(self, row_num):
        """Remove a row from the list or clear text if at minimum.
        
        Args:
            row_num: Index of row to remove.
        """
        if 0 <= row_num < len(self.rows):
            # If at minimum rows, just clear the text instead of deleting
            if len(self.rows) <= self.minimum_rows:
                self.rows[row_num].entry.delete(0, 'end')
            else:
                self.rows[row_num].destroy()
                self.rows.pop(row_num)
                
                # Reindex remaining rows
                for idx, row in enumerate(self.rows):
                    row.set_delete_callback(lambda r=idx: self.remove_row(r))
    
    def clear(self):
        """Clear all rows (respects minimum_rows)."""
        for row in self.rows:
            row.destroy()
        self.rows.clear()
        
        # Add back minimum rows if needed
        for _ in range(self.minimum_rows):
            self.add_row()
    
    def get_values(self):
        """Get all non-empty values from the list.
        
        Returns:
            List of string values.
        """
        values = []
        for row in self.rows:
            value = row.get()
            if value:
                values.append(value)
        return values
    
    def set_values(self, values):
        """Set list values by clearing and adding rows.
        
        Args:
            values: List of string values to populate.
        """
        # Clear all rows without respecting minimum
        for row in self.rows:
            row.destroy()
        self.rows.clear()
        
        # Add the values (or minimum rows if empty)
        if values:
            for value in values:
                self.add_row(value)
        else:
            # Only add minimum rows if no values provided
            for _ in range(self.minimum_rows):
                self.add_row()
    
    def __len__(self):
        """Get number of rows."""
        return len(self.rows)
    
    def __getitem__(self, index):
        """Get row by index."""
        return self.rows[index]
