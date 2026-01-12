"""
Setup script for Plex Poster Set Helper
Installs dependencies and Playwright browsers
"""
import subprocess
import sys
import platform

def main():
    print("Installing Python dependencies...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✓ Python dependencies installed successfully")
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install dependencies: {e}")
        sys.exit(1)
    
    print("\nInstalling Playwright Chromium browser...")
    try:
        subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
        print("✓ Playwright Chromium installed successfully")
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install Playwright browser: {e}")
        sys.exit(1)
    
    # Install system dependencies for Linux
    if platform.system() == "Linux":
        print("\nAttempting to install Playwright system dependencies...")
        print("(This may require sudo privileges)")
        try:
            subprocess.check_call([sys.executable, "-m", "playwright", "install-deps", "chromium"])
            print("✓ System dependencies installed successfully")
        except subprocess.CalledProcessError:
            print("⚠ Could not install system dependencies automatically")
            print("  Please run: sudo playwright install-deps chromium")
    
    print("\n" + "="*50)
    print("✓ Setup complete!")
    print("="*50)
    print("\nNext steps:")
    print("1. Edit config.json with your Plex server details")
    print("2. Run the application:")
    print("   - GUI: python main.py gui")
    print("   - CLI: python main.py cli")

if __name__ == "__main__":
    main()
