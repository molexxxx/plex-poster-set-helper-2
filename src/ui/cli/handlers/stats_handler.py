from .base_handler import BaseHandler

class StatsHandler(BaseHandler):
    """Handler for statistic viewing operations."""
    
    def handle_view_stats(self):
        """Handle viewing detailed stats."""
        self.app._setup_services()
        
        print("\n" + "="*60)
        print("         Detailed Statistics")
        print("="*60)
        
        # Load labeled items
        labeled_items = self.plex_service.get_items_by_label("Plex_poster_set_helper")
        
        if not labeled_items:
            print("\nNo items found with custom posters.")
            input("\nPress [Enter] to return to main menu...")
            return
        
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
        
        # Display comprehensive stats
        print(f"\n📊 Total Items: {len(items_list)}")
        print("\n" + "-"*60)
        print("Source Breakdown:")
        print(f"  🌐 MediUX: {len(mediux_items)} ({len(mediux_items)*100//len(items_list) if items_list else 0}%)")
        print(f"  🎨 ThePosterDB: {len(posterdb_items)} ({len(posterdb_items)*100//len(items_list) if items_list else 0}%)")
        
        # Group by library
        library_counts = {}
        for item_data in items_list:
            item = item_data['item']
            lib_name = item.section().title if hasattr(item, 'section') else 'Unknown'
            library_counts[lib_name] = library_counts.get(lib_name, 0) + 1
        
        print("\n" + "-"*60)
        print("Library Breakdown:")
        for lib_name, count in sorted(library_counts.items(), key=lambda x: x[1], reverse=True):
            percentage = count * 100 // len(items_list) if items_list else 0
            print(f"  📚 {lib_name}: {count} ({percentage}%)")
        
        # Group by type
        type_counts = {}
        for item_data in items_list:
            item = item_data['item']
            item_type = item.type.capitalize() if hasattr(item, 'type') else 'Unknown'
            type_counts[item_type] = type_counts.get(item_type, 0) + 1
        
        print("\n" + "-"*60)
        print("Media Type Breakdown:")
        for item_type, count in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
            percentage = count * 100 // len(items_list) if items_list else 0
            type_icon = "🎬" if item_type == "Movie" else "📺" if item_type in ["Show", "Season", "Episode"] else "📚"
            print(f"  {type_icon} {item_type}: {count} ({percentage}%)")
        
        input("\nPress [Enter] to return to main menu...")
