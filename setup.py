"""
Setup script for Plex Poster Set Helper
Installs dependencies and Playwright browsers
"""
import subprocess
import sys
import platform

def detect_package_manager():
    """Detect which package manager is available on Linux."""
    managers = {
        'apt': ['apt', 'update', '&&', 'sudo', 'apt', 'install', '-y', 'python3-tk', 'python3-pip'],
        'dnf': ['dnf', 'install', '-y', 'python3-tkinter', 'python3-pip'],
        'yum': ['yum', 'install', '-y', 'python3-tkinter', 'python3-pip'],
        'pacman': ['pacman', '-S', '--noconfirm', 'tk', 'python-pip'],
        'zypper': ['zypper', 'install', '-y', 'python3-tk', 'python3-pip']
    }
    
    for manager in managers:
        try:
            subprocess.check_call(['which', manager], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return manager, managers[manager]
        except subprocess.CalledProcessError:
            continue
    return None, None

def main():
    # Install system dependencies for Linux
    if platform.system() == "Linux":
        print("Installing system dependencies for GUI support...")
        print("(This requires sudo privileges)")
        
        pkg_manager, install_cmd = detect_package_manager()
        
        if pkg_manager:
            print(f"Detected package manager: {pkg_manager}")
            try:
                if pkg_manager == 'apt':
                    subprocess.check_call(["sudo", "apt", "update"])
                    subprocess.check_call(["sudo", "apt", "install", "-y", "python3-tk", "python3-pip"])
                else:
                    subprocess.check_call(["sudo"] + install_cmd)
                print("✓ System dependencies installed successfully")
            except subprocess.CalledProcessError as e:
                print(f"⚠ Could not install system dependencies: {e}")
                if pkg_manager == 'apt':
                    print("  Please run manually: sudo apt update && sudo apt install python3-tk python3-pip")
                elif pkg_manager == 'dnf':
                    print("  Please run manually: sudo dnf install python3-tkinter python3-pip")
                elif pkg_manager == 'yum':
                    print("  Please run manually: sudo yum install python3-tkinter python3-pip")
                elif pkg_manager == 'pacman':
                    print("  Please run manually: sudo pacman -S tk python-pip")
                elif pkg_manager == 'zypper':
                    print("  Please run manually: sudo zypper install python3-tk python3-pip")
        else:
            print("⚠ Could not detect package manager")
            print("  Please install python3-tk and python3-pip manually for your distribution")
        print("")
    
    # Install system dependencies for macOS
    elif platform.system() == "Darwin":
        print("Checking for GUI support on macOS...")
        
        # Check if Homebrew is installed
        brew_installed = False
        try:
            subprocess.check_call(["brew", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            brew_installed = True
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("Homebrew not found. Installing Homebrew...")
            try:
                # Install Homebrew
                install_cmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
                subprocess.check_call(install_cmd, shell=True)
                print("✓ Homebrew installed successfully")
                brew_installed = True
            except subprocess.CalledProcessError as e:
                print(f"⚠ Could not install Homebrew automatically: {e}")
                print("  Please install Homebrew manually from: https://brew.sh")
                print("  Then run: brew install python-tk")
        
        # Install python-tk if Homebrew is available
        if brew_installed:
            try:
                subprocess.check_call(["brew", "install", "python-tk"])
                print("✓ System dependencies installed successfully")
            except subprocess.CalledProcessError:
                print("⚠ Could not install python-tk")
                print("  Please run manually: brew install python-tk")
        print("")
    
    print("Installing Python dependencies...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✓ Python dependencies installed successfully")
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install dependencies: {e}")
        sys.exit(1)
    
    print("\nInstalling Playwright Chromium browser...")
    print("(This may take a few minutes to download)")
    try:
        # Run without capturing output so user sees download progress
        result = subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"])
        if result.returncode == 0:
            print("✓ Playwright Chromium installed successfully")
        else:
            print(f"✗ Failed to install Playwright browser")
            sys.exit(1)
    except Exception as e:
        print(f"✗ Failed to install Playwright browser: {e}")
        sys.exit(1)
    
    # Install Playwright system dependencies for Linux
    if platform.system() == "Linux":
        print("\nInstalling Playwright system dependencies...")
        print("(This may require sudo privileges)")
        try:
            subprocess.check_call([sys.executable, "-m", "playwright", "install-deps", "chromium"])
            print("✓ Playwright system dependencies installed successfully")
        except subprocess.CalledProcessError:
            print("⚠ Could not install Playwright system dependencies automatically")
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
