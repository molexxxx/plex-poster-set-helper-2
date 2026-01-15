from .base_handler import BaseHandler

class MappingHandler(BaseHandler):
    """Handler for title mapping operations."""
    
    def handle_menu(self):
        """Handle title mappings management."""
        while True:
            print("\n" + "="*60)
            print("         Title Mappings Management")
            print("="*60)
            print("\nCurrent Mappings:")
            
            if self.config.title_mappings:
                for i, (original, plex_title) in enumerate(self.config.title_mappings.items(), 1):
                    print(f"  {i}. '{original}' → '{plex_title}'")
            else:
                print("  (No mappings configured)")
            
            print("\nOptions:")
            print("1. Add New Mapping")
            print("2. Remove Mapping")
            print("3. Clear All Mappings")
            print("4. Back to Main Menu")
            
            choice = input("\nSelect an option (1-4): ").strip()
            
            if choice == '1':
                self._add_title_mapping()
            elif choice == '2':
                self._remove_title_mapping()
            elif choice == '3':
                self._clear_title_mappings()
            elif choice == '4':
                break
            else:
                print("Invalid choice. Please select an option between 1 and 4.")
    
    def _add_title_mapping(self):
        """Add a new title mapping."""
        print("\nAdd Title Mapping")
        print("-" * 60)
        original = input("Enter the original title (from poster source): ").strip()
        if not original:
            print("Original title cannot be empty.")
            return
        
        plex_title = input("Enter the Plex library title: ").strip()
        if not plex_title:
            print("Plex title cannot be empty.")
            return
        
        # Add to config
        if not self.config.title_mappings:
            self.config.title_mappings = {}
        
        self.config.title_mappings[original] = plex_title
        
        if self.config_manager.save(self.config):
            print(f"✓ Added mapping: '{original}' → '{plex_title}'")
        else:
            print("✗ Error saving title mapping.")
    
    def _remove_title_mapping(self):
        """Remove a title mapping."""
        if not self.config.title_mappings:
            print("\nNo mappings to remove.")
            return
        
        print("\nRemove Title Mapping")
        print("-" * 60)
        print("Enter the number of the mapping to remove:")
        
        mappings_list = list(self.config.title_mappings.items())
        for i, (original, plex_title) in enumerate(mappings_list, 1):
            print(f"  {i}. '{original}' → '{plex_title}'")
        
        choice = input(f"\nSelect mapping (1-{len(mappings_list)}) or [Enter] to cancel: ").strip()
        
        if not choice:
            return
        
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(mappings_list):
                original, plex_title = mappings_list[idx]
                del self.config.title_mappings[original]
                
                if self.config_manager.save(self.config):
                    print(f"✓ Removed mapping: '{original}' → '{plex_title}'")
                else:
                    print("✗ Error saving changes.")
            else:
                print("Invalid selection.")
        else:
            print("Invalid input.")
    
    def _clear_title_mappings(self):
        """Clear all title mappings."""
        if not self.config.title_mappings:
            print("\nNo mappings to clear.")
            return
        
        confirm = input(f"\nAre you sure you want to delete all {len(self.config.title_mappings)} mappings? (yes/no): ").strip().lower()
        
        if confirm in ['yes', 'y']:
            self.config.title_mappings = {}
            if self.config_manager.save(self.config):
                print("✓ All mappings cleared.")
            else:
                print("✗ Error saving changes.")
        else:
            print("Operation cancelled.")
