from .base_handler import BaseHandler

class ResetHandler(BaseHandler):
    """Handler for reset posters operations."""
    
    def handle_menu(self):
        """Handle reset posters menu."""
        self.app._setup_services()
        
        while True:
            print("\n" + "="*60)
            print("         Reset Posters to Default")
            print("="*60)
            
            # Load labeled items
            labeled_items = self.plex_service.get_items_by_label("Plex_poster_set_helper")
            
            if not labeled_items:
                print("\nNo items found with custom posters.")
                input("\nPress [Enter] to return to main menu...")
                break
            
            # Calculate stats
            mediux_items = self.plex_service.get_items_by_label("Plex_poster_set_helper_mediux")
            posterdb_items = self.plex_service.get_items_by_label("Plex_poster_set_helper_posterdb")
            
            # Deduplicate by ratingKey
            all_items_dict = {}
            for item in labeled_items + mediux_items + posterdb_items:
                if item.ratingKey not in all_items_dict:
                    # Determine source
                    source = "Unknown"
                    for m_item in mediux_items:
                        if m_item.ratingKey == item.ratingKey:
                            source = "MediUX"
                            break
                    if source == "Unknown":
                        for p_item in posterdb_items:
                            if p_item.ratingKey == item.ratingKey:
                                source = "ThePosterDB"
                                break
                    
                    all_items_dict[item.ratingKey] = {
                        'item': item,
                        'source': source
                    }
            
            items_list = list(all_items_dict.values())
            
            # Display stats
            print(f"\n📊 Found {len(items_list)} items with custom posters")
            print(f"   🌐 MediUX: {len(mediux_items)}")
            print(f"   🎨 ThePosterDB: {len(posterdb_items)}")
            
            # Group by library
            library_counts = {}
            for item_data in items_list:
                item = item_data['item']
                lib_name = item.section().title if hasattr(item, 'section') else 'Unknown'
                library_counts[lib_name] = library_counts.get(lib_name, 0) + 1
            
            print("\n📚 By Library:")
            for lib_name, count in sorted(library_counts.items()):
                print(f"   {lib_name}: {count}")
            
            print("\nOptions:")
            print("1. Browse/Search Items (Filter and Select)")
            print("2. Reset All Items")
            print("3. Back to Main Menu")
            
            choice = input("\nSelect an option (1-3): ").strip()
            
            if choice == '1':
                if self._browse_and_reset_items(items_list):
                    # Items were reset, reload the list by continuing the loop
                    print("\n🔄 Refreshing item list...")
                    continue
            elif choice == '2':
                if self._reset_all_items(items_list):
                    # Items were reset, reload the list by continuing the loop
                    print("\n🔄 Refreshing item list...")
                    continue
            elif choice == '3':
                break
            else:
                print("Invalid choice. Please select an option between 1 and 3.")
                
    def _browse_and_reset_items(self, items_list):
        """Browse and reset items with search/filter functionality."""
        search_text = ""
        filter_mediux = True
        filter_posterdb = True
        
        while True:
            # Apply filters
            filtered_items = self._apply_item_filters(items_list, search_text, filter_mediux, filter_posterdb)
            
            print("\n" + "="*60)
            print("         Browse/Search Items")
            print("="*60)
            
            # Show current filters
            if search_text or not filter_mediux or not filter_posterdb:
                print("\n🔍 Active Filters:")
                if search_text:
                    print(f"   Search: '{search_text}'")
                if not filter_mediux:
                    print("   🌐 MediUX: Hidden")
                if not filter_posterdb:
                    print("   🎨 ThePosterDB: Hidden")
            
            print(f"\n📊 Showing {len(filtered_items)} of {len(items_list)} items")
            
            if not filtered_items:
                print("\n⚠️  No items match the current filters.")
            else:
                # Show items with pagination
                page_size = 15
                print("\nItems:")
                print("-" * 60)
                
                for i in range(min(page_size, len(filtered_items))):
                    item_data = filtered_items[i]
                    item = item_data['item']
                    source = item_data['source']
                    
                    lib_name = item.section().title if hasattr(item, 'section') else 'Unknown'
                    type_icon = "🎬" if item.type == "movie" else "📺" if item.type in ["show", "season", "episode"] else "📚"
                    source_icon = "🌐" if source == "MediUX" else "🎨" if source == "ThePosterDB" else "❓"
                    
                    print(f"  {i+1}. {type_icon} {item.title} {source_icon} [{lib_name}]")
                
                if len(filtered_items) > page_size:
                    print(f"\n... and {len(filtered_items) - page_size} more items")
            
            print("\nOptions:")
            print("1. Search by Title")
            print("2. Toggle MediUX Filter (Currently: {})".format("ON" if filter_mediux else "OFF"))
            print("3. Toggle ThePosterDB Filter (Currently: {})".format("ON" if filter_posterdb else "OFF"))
            print("4. Clear All Filters")
            print("5. Reset Item by Number")
            print("6. Reset All Filtered Items")
            print("7. Back to Previous Menu")
            
            choice = input("\nSelect an option (1-7): ").strip()
            
            if choice == '1':
                search_text = input("Enter search text (or press [Enter] to clear): ").strip()
                print(f"✓ Search filter {'applied' if search_text else 'cleared'}.")
            elif choice == '2':
                filter_mediux = not filter_mediux
                print(f"✓ MediUX filter {'enabled' if filter_mediux else 'disabled'}.")
            elif choice == '3':
                filter_posterdb = not filter_posterdb
                print(f"✓ ThePosterDB filter {'enabled' if filter_posterdb else 'disabled'}.")
            elif choice == '4':
                search_text = ""
                filter_mediux = True
                filter_posterdb = True
                print("✓ All filters cleared.")
            elif choice == '5':
                if filtered_items:
                    if self._reset_item_by_number(filtered_items):
                        # Item was reset, reload the list
                        return True
                else:
                    print("⚠️  No items to reset with current filters.")
            elif choice == '6':
                if filtered_items:
                    if self._reset_filtered_items(filtered_items, len(items_list)):
                        # Items were reset, reload the list
                        return True
                else:
                    print("⚠️  No items to reset with current filters.")
            elif choice == '7':
                break
            else:
                print("Invalid choice. Please select an option between 1 and 7.")
        
        return False
    
    def _apply_item_filters(self, items_list, search_text, filter_mediux, filter_posterdb):
        """Apply search and source filters to items list."""
        filtered = []
        
        for item_data in items_list:
            item = item_data['item']
            source = item_data['source']
            
            # Apply source filters
            if source == "MediUX" and not filter_mediux:
                continue
            if source == "ThePosterDB" and not filter_posterdb:
                continue
            
            # Apply search filter (case-insensitive)
            if search_text:
                if search_text.lower() not in item.title.lower():
                    continue
            
            filtered.append(item_data)
        
        return filtered
        
    def _reset_item_by_number(self, filtered_items):
        """Reset a specific item by its number in the filtered list.
        
        Returns:
            True if item was reset, False otherwise.
        """
        print("\n" + "-"*60)
        print("Reset Item by Number")
        print("-" * 60)
        
        # Show more items for context
        display_count = min(20, len(filtered_items))
        for i in range(display_count):
            item_data = filtered_items[i]
            item = item_data['item']
            source = item_data['source']
            
            lib_name = item.section().title if hasattr(item, 'section') else 'Unknown'
            type_icon = "🎬" if item.type == "movie" else "📺" if item.type in ["show", "season", "episode"] else "📚"
            source_icon = "🌐" if source == "MediUX" else "🎨" if source == "ThePosterDB" else "❓"
            
            print(f"  {i+1}. {type_icon} {item.title} {source_icon} [{lib_name}]")
        
        if len(filtered_items) > display_count:
            print(f"\n... and {len(filtered_items) - display_count} more items")
        
        choice = input(f"\nEnter item number (1-{len(filtered_items)}) or [Enter] to cancel: ").strip()
        
        if not choice:
            return
        
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(filtered_items):
                item_data = filtered_items[idx]
                item = item_data['item']
                
                confirm = input(f"\nReset '{item.title}' to default poster? (yes/no): ").strip().lower()
                
                if confirm in ['yes', 'y']:
                    print(f"Resetting '{item.title}'...")
                    try:
                        self.plex_service.delete_posters_from_items([item])
                        # Remove all three labels (main + source-specific)
                        self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper")
                        self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper_mediux")
                        self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper_posterdb")
                        print(f"✓ Successfully reset '{item.title}' to default poster.")
                        input("\nPress [Enter] to continue...")
                        return True
                    except Exception as e:
                        print(f"✗ Error resetting item: {str(e)}")
                        input("\nPress [Enter] to continue...")
                        return False
                else:
                    print("Operation cancelled.")
            else:
                print("Invalid selection.")
        else:
            print("Invalid input.")
        
        return False
        
    def _reset_filtered_items(self, filtered_items, total_items):
        """Reset all filtered items.
        
        Returns:
            True if items were reset, False otherwise.
        """
        print("\n" + "-"*60)
        print("Reset Filtered Items")
        print("-" * 60)
        
        if len(filtered_items) == total_items:
            confirm = input(f"\n⚠️  Reset ALL {len(filtered_items)} items to default posters?\nThis cannot be undone. (yes/no): ").strip().lower()
        else:
            confirm = input(f"\n⚠️  Reset {len(filtered_items)} filtered items (of {total_items} total) to default posters?\nThis cannot be undone. (yes/no): ").strip().lower()
        
        if confirm in ['yes', 'y']:
            print(f"\nResetting {len(filtered_items)} items...")
            
            items_to_reset = [item_data['item'] for item_data in filtered_items]
            
            try:
                total = len(items_to_reset)
                for i, item in enumerate(items_to_reset, 1):
                    print(f"[{i}/{total}] Resetting '{item.title}'...")
                    self.plex_service.delete_posters_from_items([item])
                    # Remove all three labels (main + source-specific)
                    self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper")
                    self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper_mediux")
                    self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper_posterdb")
                
                print(f"\n✓ Successfully reset {total} items to default posters.")
                input("\nPress [Enter] to continue...")
                return True
            except Exception as e:
                print(f"✗ Error during reset: {str(e)}")
                input("\nPress [Enter] to continue...")
                return False
        else:
            print("Operation cancelled.")
        
        return False
        
    def _reset_all_items(self, items_list):
        """Reset all items to default posters.
        
        Returns:
            True if items were reset, False otherwise.
        """
        print("\n" + "="*60)
        print("         Reset All Items")
        print("="*60)
        
        confirm = input(f"\n⚠️  Are you sure you want to reset ALL {len(items_list)} items to default posters?\nThis cannot be undone. (yes/no): ").strip().lower()
        
        if confirm in ['yes', 'y']:
            print(f"\nResetting {len(items_list)} items...")
            
            items_to_reset = [item_data['item'] for item_data in items_list]
            
            try:
                total = len(items_to_reset)
                for i, item in enumerate(items_to_reset, 1):
                    print(f"[{i}/{total}] Resetting '{item.title}'...")
                    self.plex_service.delete_posters_from_items([item])
                    # Remove all three labels (main + source-specific)
                    self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper")
                    self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper_mediux")
                    self.plex_service.remove_label_from_items([item], "Plex_poster_set_helper_posterdb")
                
                print(f"\n✓ Successfully reset all {total} items to default posters.")
                input("\nPress [Enter] to continue...")
                return True
            except Exception as e:
                print(f"✗ Error during reset: {str(e)}")
                input("\nPress [Enter] to continue...")
                return False
        else:
            print("Operation cancelled.")
        
        return False
