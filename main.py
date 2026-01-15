"""Main entry point for Plex Poster Set Helper."""

import sys
import atexit
import subprocess

from src.ui.gui import PlexPosterGUI
from src.ui.cli import PlexPosterCLI


# Interactive CLI mode flag
INTERACTIVE_CLI = True  # Set to False when building executable for GUI default


def check_playwright_browsers():
    """Check if Playwright browsers are installed."""
    try:
        # Try to check if chromium is installed
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "--dry-run", "chromium"],
            capture_output=True,
            text=True,
            timeout=5
        )
        return True
    except Exception:
        return False


def prompt_playwright_install():
    """Prompt user to install Playwright browsers."""
    print("\n" + "="*60)
    print("⚠ WARNING: Playwright browser not detected!")
    print("="*60)
    print("\nThe scraping functionality requires Playwright's Chromium browser.")
    print("\nTo install it, run:")
    print("  python -m playwright install chromium")
    print("\nOr use the automated setup script:")
    print("  python setup.py")
    print("\n" + "="*60)
    
    response = input("\nWould you like to install it now? (y/n): ").strip().lower()
    if response in ['y', 'yes']:
        print("\nInstalling Playwright Chromium browser...")
        try:
            subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
            print("✓ Installation complete!\n")
            return True
        except subprocess.CalledProcessError as e:
            print(f"✗ Installation failed: {e}")
            print("Please try running manually: python -m playwright install chromium\n")
            return False
    else:
        print("\nNote: Scraping will not work until Playwright is properly installed.\n")
        return False


def cleanup():
    """Cleanup function called on exit."""
    print("Exiting application. Cleanup complete.")


def main():
    """Main application entry point."""
    # Register cleanup function
    atexit.register(cleanup)
    
    # Check for Playwright browsers (skip for built executables)
    if not getattr(sys, 'frozen', False):
        if not check_playwright_browsers():
            prompt_playwright_install()
    
    # Check for command-line arguments
    if len(sys.argv) > 1:
        command = sys.argv[1].lower()
        
        if command == 'gui':
            # Launch GUI
            app = PlexPosterGUI()
            app.run()
        
        elif command == 'cli':
            # Launch interactive CLI
            cli = PlexPosterCLI()
            cli.run()
        
        elif command == 'bulk':
            # Process bulk import file
            cli = PlexPosterCLI()
            
            if len(sys.argv) > 2:
                file_path = sys.argv[2]
            else:
                # Use first bulk file from config or default
                file_path = cli.config.bulk_files[0] if cli.config.bulk_files else "bulk_import.txt"
            
            cli.process_bulk_file(file_path)
        
        elif command.startswith('http'):
            # Process single URL
            cli = PlexPosterCLI()
            cli.process_url(command)
        
        else:
            print("Usage:")
            print("  python main.py gui              - Launch GUI")
            print("  python main.py cli              - Launch interactive CLI")
            print("  python main.py bulk [file]      - Process bulk import file")
            print("  python main.py <url>            - Process single URL")
            sys.exit(1)
    
    else:
        # No arguments provided
        if INTERACTIVE_CLI:
            # Launch interactive CLI
            cli = PlexPosterCLI()
            cli.run()
        else:
            # Launch GUI by default (for built executable)
            app = PlexPosterGUI()
            app.run()


if __name__ == "__main__":
    main()
