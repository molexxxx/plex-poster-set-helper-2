"""Handler for managing labeled items and poster resets."""

import threading
import time
import customtkinter as ctk


class LabelHandler:
    """Handles labeled item management and poster reset operations."""
    
    def __init__(self, app):
        """Initialize label handler.
        
        Args:
            app: Main application instance.
        """
        self.app = app
        self.is_refreshing_labels = False
        self.labeled_items_all = []
    
    def refresh_labeled_items(self):
        """Refresh the list of labeled items in a separate thread."""
        if self.is_refreshing_labels:
            return  # Already refreshing, skip
        
        self.app.logger.info("Loading labeled items from Plex...")
        try:
            self.app._setup_services()
            
            if not self.app.plex_service.tv_libraries and not self.app.plex_service.movie_libraries:
                self.app.logger.warning("Plex setup incomplete - no libraries configured")
                self.app.app.after(0, lambda: self.app.labeled_count_label.configure(
                    text="Plex setup incomplete. Please configure your settings."))
                return
            
            # Get items with the label
            items = self.app.plex_service.get_items_by_label('plex_poster_set_helper')
            self.app.logger.debug(f"Found {len(items)} items with main label")
            
            # Also get items with source-specific labels (in case main label was removed)
            mediux_items = self.app.plex_service.get_items_by_label('plex_poster_set_helper_mediux')
            posterdb_items = self.app.plex_service.get_items_by_label('plex_poster_set_helper_posterdb')
            self.app.logger.debug(f"Found {len(mediux_items)} MediUX items, {len(posterdb_items)} PosterDB items")
            
            # Combine and deduplicate by rating key
            all_items_dict = {item.ratingKey: item for item in items}
            for item in mediux_items:
                all_items_dict[item.ratingKey] = item
            for item in posterdb_items:
                all_items_dict[item.ratingKey] = item
            
            combined_items = list(all_items_dict.values())
            self.app.logger.info(f"Total labeled items after deduplication: {len(combined_items)}")
            
            # Schedule widget cleanup and recreation on main thread
            self.app.app.after(0, lambda: self._update_labeled_items_display(combined_items))
        
        except Exception as e:
            self.app.logger.exception(f"Error loading labeled items: {str(e)}")
            self.app.app.after(0, lambda: self.app.labeled_count_label.configure(
                text=f"Error loading items: {str(e)}"))
        finally:
            self.is_refreshing_labels = False
    
    def _update_labeled_items_display(self, items):
        """Update the display with loaded items (runs on main thread).
        
        Args:
            items: List of Plex items to display.
        """
        # Store all items for filtering
        self.labeled_items_all = items
        
        # Apply filters to display
        self.apply_label_filters()
    
    def apply_label_filters(self):
        """Apply search and source filters to the labeled items list."""
        if not self.labeled_items_all:
            return
        
        # Get filter values
        search_text = self.app.labeled_search_var.get().lower() if self.app.labeled_search_var else ""
        show_mediux = self.app.labeled_filter_mediux.get() if self.app.labeled_filter_mediux else True
        show_posterdb = self.app.labeled_filter_posterdb.get() if self.app.labeled_filter_posterdb else True
        show_movies = self.app.labeled_filter_movies.get() if self.app.labeled_filter_movies else True
        show_tv = self.app.labeled_filter_tv.get() if self.app.labeled_filter_tv else True
        
        # Filter items
        filtered_items = []
        for item in self.labeled_items_all:
            # Get item source
            item_source = None
            try:
                labels = [label.tag for label in item.labels]
                if 'Plex_poster_set_helper_mediux' in labels:
                    item_source = 'mediux'
                elif 'Plex_poster_set_helper_posterdb' in labels:
                    item_source = 'posterdb'
            except:
                pass
            
            # Apply source filter
            if item_source == 'mediux' and not show_mediux:
                continue
            if item_source == 'posterdb' and not show_posterdb:
                continue
            
            # Apply library type filter
            item_type = item.type
            if item_type == 'movie' and not show_movies:
                continue
            if item_type in ['show', 'season', 'episode'] and not show_tv:
                continue
            
            # Apply search filter
            if search_text:
                item_title = item.title.lower()
                if search_text not in item_title:
                    continue
            
            filtered_items.append(item)
        
        # Update display with filtered items
        self._display_filtered_items(filtered_items)
    
    def _display_filtered_items(self, items):
        """Display the filtered items list.
        
        Args:
            items: Filtered list of items to display.
        """
        # Clear existing list
        for widget in self.app.labeled_items_scroll.winfo_children():
            widget.destroy()
        
        # Calculate stats from ALL items (not filtered)
        all_count = len(self.labeled_items_all)
        library_counts = {}
        library_types = {}
        source_counts = {'mediux': 0, 'posterdb': 0}
        
        for item in self.labeled_items_all:
            # Count by library
            library = item.librarySectionTitle
            library_counts[library] = library_counts.get(library, 0) + 1
            
            # Store library type for icon
            if library not in library_types:
                library_types[library] = item.type
            
            # Count by source
            try:
                labels = [label.tag for label in item.labels]
                if 'Plex_poster_set_helper_mediux' in labels:
                    source_counts['mediux'] += 1
                elif 'Plex_poster_set_helper_posterdb' in labels:
                    source_counts['posterdb'] += 1
            except:
                pass
        
        # Update main count (show filtered/total)
        filtered_count = len(items)
        if filtered_count == all_count:
            count_text = f"Found {all_count} item{'s' if all_count != 1 else ''} with custom posters"
        else:
            count_text = f"Showing {filtered_count} of {all_count} item{'s' if all_count != 1 else ''} with custom posters"
        self.app.labeled_count_label.configure(text=count_text)
        
        # Build library breakdown text (from ALL items) - Left Column
        library_text_parts = []
        movie_count = 0
        tv_count = 0
        
        if library_counts:
            for library, lib_count in sorted(library_counts.items()):
                lib_type = library_types.get(library, 'movie')
                if lib_type in ['show', 'season', 'episode']:
                    tv_count += lib_count
                elif lib_type != 'collection':
                    movie_count += lib_count
        
        # Build library type summary
        if movie_count > 0:
            library_text_parts.append(f"🎬 Movies: {movie_count}")
        if tv_count > 0:
            library_text_parts.append(f"📺 TV Shows: {tv_count}")
        
        library_text = "\n".join(library_text_parts) if library_text_parts else ""
        self.app.labeled_library_label.configure(text=library_text)
        
        # Build source breakdown text - Right Column
        source_text_parts = []
        if source_counts['mediux'] > 0:
            source_text_parts.append(f"🌐 MediUX: {source_counts['mediux']}")
        if source_counts['posterdb'] > 0:
            source_text_parts.append(f"🎨 ThePosterDB: {source_counts['posterdb']}")
        
        source_text = "\n".join(source_text_parts) if source_text_parts else ""
        self.app.labeled_source_label.configure(text=source_text)
        
        # Display filtered items
        for idx, item in enumerate(items):
            self._create_labeled_item_row(item, idx)
        
        if filtered_count == 0:
            if all_count == 0:
                message = "No labeled items found. Posters uploaded after this update will be tracked here."
            else:
                message = "No items match the current filters. Try adjusting your search or filter settings."
            
            no_items_label = ctk.CTkLabel(
                self.app.labeled_items_scroll,
                text=message,
                text_color="#696969",
                font=("Roboto", 13)
            )
            no_items_label.grid(row=0, column=0, pady=20, padx=10)
    
    def clear_label_filters(self):
        """Clear all filters and show all items."""
        if self.app.labeled_search_var:
            self.app.labeled_search_var.set("")
        if self.app.labeled_filter_mediux:
            self.app.labeled_filter_mediux.set(True)
        if self.app.labeled_filter_posterdb:
            self.app.labeled_filter_posterdb.set(True)
        if self.app.labeled_filter_movies:
            self.app.labeled_filter_movies.set(True)
        if self.app.labeled_filter_tv:
            self.app.labeled_filter_tv.set(True)
        self.apply_label_filters()
    
    def _create_labeled_item_row(self, item, row_index):
        """Create a row displaying a labeled item.
        
        Args:
            item: Plex item object.
            row_index: Row index for grid placement.
        """
        row_frame = ctk.CTkFrame(self.app.labeled_items_scroll, fg_color="#2A2B2B", corner_radius=5)
        row_frame.grid(row=row_index, column=0, padx=5, pady=2, sticky="ew")
        row_frame.grid_columnconfigure(0, weight=1)
        row_frame.grid_columnconfigure(1, weight=0)
        row_frame.grid_columnconfigure(2, weight=0)
        row_frame.grid_columnconfigure(3, weight=0)
        
        # Get item details
        item_type = item.type
        title = item.title
        library = item.librarySectionTitle
        
        # Determine source from labels
        source_text = ""
        try:
            labels = [label.tag for label in item.labels]
            if 'Plex_poster_set_helper_mediux' in labels:
                source_text = "🌐 MediUX"
            elif 'Plex_poster_set_helper_posterdb' in labels:
                source_text = "🎨 ThePosterDB"
        except:
            pass
        
        # Build display text
        if item_type == 'movie':
            display_text = f"🎬 {title} ({item.year if hasattr(item, 'year') else 'N/A'})"
        elif item_type == 'show':
            display_text = f"📺 {title}"
        elif item_type == 'season':
            parent_title = item.parentTitle if hasattr(item, 'parentTitle') else 'Unknown Show'
            season_num = item.index if hasattr(item, 'index') else 'N/A'
            display_text = f"📺 {parent_title} - Season {season_num}"
        elif item_type == 'episode':
            show_title = item.grandparentTitle if hasattr(item, 'grandparentTitle') else 'Unknown Show'
            season_num = item.parentIndex if hasattr(item, 'parentIndex') else 'N/A'
            episode_num = item.index if hasattr(item, 'index') else 'N/A'
            display_text = f"📺 {show_title} - S{season_num}E{episode_num}: {title}"
        elif item_type == 'collection':
            display_text = f"📚 Collection: {title}"
        else:
            display_text = f"{item_type.capitalize()}: {title}"
        
        # Title label
        item_label = ctk.CTkLabel(
            row_frame,
            text=display_text,
            text_color="#CECECE",
            font=("Roboto", 12),
            anchor="w"
        )
        item_label.grid(row=0, column=0, padx=(10, 5), pady=6, sticky="w")
        
        # Source label (if available)
        if source_text:
            source_label = ctk.CTkLabel(
                row_frame,
                text=source_text,
                text_color="#A0A0A0",
                font=("Roboto", 11),
                anchor="e"
            )
            source_label.grid(row=0, column=1, padx=5, pady=6, sticky="e")
        
        # Library label
        library_label = ctk.CTkLabel(
            row_frame,
            text=library,
            text_color="#808080",
            font=("Roboto", 11),
            anchor="e"
        )
        library_label.grid(row=0, column=2, padx=5, pady=6, sticky="e")
        
        # Reset button for individual item
        reset_btn = ctk.CTkButton(
            row_frame,
            text="Reset",
            command=lambda i=item: self.reset_single_item(i),
            fg_color="#8B0000",
            hover_color="#A00000",
            width=70,
            height=24,
            font=("Roboto", 11)
        )
        reset_btn.grid(row=0, column=3, padx=10, pady=6, sticky="e")
    
    def reset_single_item(self, item):
        """Reset poster for a single item.
        
        Args:
            item: Plex item to reset.
        """
        import tkinter.messagebox as messagebox
        
        result = messagebox.askyesno(
            "Confirm Reset",
            f"Reset poster for '{item.title}' to default?\n\nThis will set it to use the default poster and remove the label.\n\nNote: Uploaded poster files remain in Plex.",
            icon='warning'
        )
        
        if result:
            threading.Thread(target=self._perform_single_reset, args=(item,)).start()
    
    def _perform_single_reset(self, item):
        """Perform the reset operation for a single item.
        
        Args:
            item: Plex item to reset.
        """
        try:
            self.app._setup_services()
            
            self.app._update_status(f"Resetting poster for {item.title}...", color="#E5A00D")
            
            # Reset poster
            self.app.plex_service.delete_posters_from_items([item])
            
            # Remove all labels (main and source-specific)
            self.app.plex_service.remove_label_from_items([item], 'plex_poster_set_helper')
            self.app.plex_service.remove_label_from_items([item], 'plex_poster_set_helper_mediux')
            self.app.plex_service.remove_label_from_items([item], 'plex_poster_set_helper_posterdb')
            
            self.app._update_status(f"✓ Reset poster for {item.title}!", color="#E5A00D")
            
            # Schedule refresh after a short delay to avoid widget conflicts
            time.sleep(0.5)
            self.refresh_labeled_items()
        
        except Exception as e:
            self.app._update_status(f"Error resetting poster: {str(e)}", color="red")
    
    def delete_labeled_posters(self):
        """Reset posters to default for all tracked items."""
        import tkinter.messagebox as messagebox
        
        result = messagebox.askyesno(
            "Confirm Reset Posters",
            "Are you sure you want to reset all posters to their defaults?\n\nThis will:\n• Set items to use their default posters (from metadata agents)\n• Remove the 'plex_poster_set_helper' label\n\nNote: Uploaded poster files will remain in Plex but won't be displayed.\nUse a tool like ImageMaid to clean up orphaned files if needed.",
            icon='warning'
        )
        
        if result:
            threading.Thread(target=self._perform_delete_posters).start()
    
    def _perform_delete_posters(self):
        """Perform the poster deletion operation."""
        try:
            self.app._setup_services()
            
            if not self.app.plex_service.tv_libraries and not self.app.plex_service.movie_libraries:
                self.app._update_status("Plex setup incomplete. Please configure your settings.", color="red")
                return
            
            self.app._update_status("Resetting posters to defaults...", color="#E5A00D")
            
            # Get all items with the label
            items = self.app.plex_service.get_items_by_label('plex_poster_set_helper')
            total_items = len(items)
            
            if total_items == 0:
                self.app._update_status("No labeled items found to reset.", color="orange")
                return
            
            self.app.logger.info(f"Resetting {total_items} items to default posters")
            
            # Reset posters for all items
            self.app.plex_service.delete_posters_from_items(items)
            
            # Remove the label from all items
            self.app.plex_service.remove_label_from_items(items, 'plex_poster_set_helper')
            self.app.plex_service.remove_label_from_items(items, 'plex_poster_set_helper_mediux')
            self.app.plex_service.remove_label_from_items(items, 'plex_poster_set_helper_posterdb')
            
            self.app._update_status(f"✓ Reset {total_items} poster(s) to defaults!", color="#E5A00D")
            
            # Refresh the list
            time.sleep(0.5)
            self.refresh_labeled_items()
        
        except Exception as e:
            self.app.logger.exception(f"Error resetting posters: {str(e)}")
            self.app._update_status(f"Error resetting posters: {str(e)}", color="red")
