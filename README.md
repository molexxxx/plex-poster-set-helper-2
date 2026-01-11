
# Plex Poster Set Helper

Automatically download and apply poster sets from ThePosterDB and MediUX to your Plex Media Server in seconds. This tool streamlines the process of updating your Plex library with high-quality custom posters, supporting both movies and TV shows with season and episode artwork.

> **Cross-Platform Support:** Fully compatible with Windows, Linux (Ubuntu, Debian, Unraid), and macOS. See [Linux-specific instructions](#linux-specific-issues-ubuntudebianunraid) for Ubuntu/Unraid users.

## Features

- **Multiple Source Support**
  - ThePosterDB sets, single posters, and user uploads
  - MediUX sets with full-quality image downloads
  
- **Flexible Usage Modes**
  - Interactive CLI with menu-driven interface
  - Direct command-line execution
  - Modern GUI built with CustomTkinter
  - Bulk import from text files
  
- **Smart Matching**
  - Automatic media detection and matching
  - Support for movies, TV shows, seasons, and collections
  - Multiple library support
---

## Installation

### Prerequisites
- Python 3.8 or higher
- Plex Media Server with API access
- **Linux Users:** tkinter for GUI support (see Linux-specific instructions below)

### Setup

1. **Clone or download this repository**
   ```bash
   git clone https://github.com/tonywied17/plex-poster-set-helper.git
   cd plex-poster-set-helper
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```
   
   **For Linux (Ubuntu/Debian/Unraid):**
   ```bash
   # Install system dependencies for GUI support
   sudo apt update
   sudo apt install python3-tk python3-pip
   
   # Install Python packages
   pip3 install -r requirements.txt
   
   # Install Playwright browser
   python3 -m playwright install chromium
   python3 -m playwright install-deps chromium
   ```
   
   **For Unraid Docker Users:**
   - Use CLI mode: `python main.py cli`
   - Or set up a Docker container with GUI support (see Troubleshooting section)

3. **Configure your Plex connection**
   
  Your settings can be modified in the `config.json` file.

   ```json
   {
     "base_url": "http://192.168.1.100:32400",
     "token": "your_plex_token_here",
     "movie_library": "Movies",
     "tv_library": "TV Shows",
     "bulk_files": ["bulk_import.txt"],
     "mediux_filters": ["poster", "backdrop", "title_card"],
     "title_mappings": {
       "Pluribus": "PLUR1BUS",
       "The Office": "The Office (US)"
     }
   }
   ```

   **Configuration Options:**
   
   | Option | Description | Example |
   |--------|-------------|---------|
   | `base_url` | Your Plex server URL and port | `"http://192.168.1.100:32400"` |
   | `token` | Plex authentication token ([How to find](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)) | `"aBc123XyZ..."` |
   | `movie_library` | Name of your Movies library | `"Movies"` or `["Movies", "4K Movies"]` |
   | `tv_library` | Name of your TV Shows library | `"TV Shows"` or `["TV", "Anime"]` |
   | `bulk_files` | List of bulk import text files | `["bulk_import.txt", "movies.txt"]` |
   | `mediux_filters` | MediUX media types to download | `["poster", "backdrop", "title_card"]` |
   | `title_mappings` | Manual title overrides for non-matching names | `{"Source Title": "Plex Title"}` |

   > **Multiple Libraries:** You can specify multiple libraries as arrays to apply posters across all of them simultaneously.
   
   > **Multiple Bulk Files:** The `bulk_files` array supports multiple text files for organizing different import lists (e.g., movies, TV shows, seasonal updates).

---

## Usage

### Interactive CLI Mode

Run the script without arguments to enter interactive mode:

```bash
python main.py
```

![CLI Overview](https://raw.githubusercontent.com/tonywied17/plex-poster-set-helper/refs/heads/main/.github/cli.png)

**Menu Options:**
1. **Single URL Import** - Paste a ThePosterDB or MediUX link to import that set
2. **Bulk Import** - Process multiple URLs from a text file
3. **Launch GUI** - Open the graphical interface
4. **Exit** - Close the application

### Command-Line Arguments

**Single URL:**
```bash
python main.py https://theposterdb.com/set/12345
```

**Bulk Import:**
```bash
python main.py bulk bulk_import.txt
```

**Launch GUI:**
```bash
python main.py gui
```

### GUI Mode

Launch the graphical interface for a more visual experience:

```bash
python main.py gui
```

![GUI 1](https://raw.githubusercontent.com/tonywied17/plex-poster-set-helper/refs/heads/main/.github/bulk.png)
![GUI 2](https://raw.githubusercontent.com/tonywied17/plex-poster-set-helper/refs/heads/main/.github/title_mappings.png)
![GUI 3](https://raw.githubusercontent.com/tonywied17/plex-poster-set-helper/refs/heads/main/.github/config.png)

The GUI provides an intuitive interface with multiple tabs:

**Settings Tab:**
- Configure Plex server URL and authentication token
- Set up movie and TV show libraries
- Configure MediUX download filters
- Adjust concurrent worker settings (1 to CPU core count)

**Title Mappings Tab:**
- Visual editor for title mapping overrides
- Add/remove mappings with dedicated buttons
- Manual save control for all changes

**Bulk Import Tab:**
- Manage multiple bulk import files via dropdown
- Create new bulk files or delete existing ones
- Row-based URL editor with duplicate detection
- Comment support (lines starting with `#` or `//`)
- Manual save/reload functionality

**Poster Scrape Tab:**
- Add multiple URLs for concurrent processing
- Real-time visual feedback (orange border = processing, green = completed, red = error)
- Progress bar showing active workers and completion status
- Configurable worker count for parallel processing

**Advanced Features:**
- **Concurrent Processing:** Process multiple URLs simultaneously with configurable worker threads
- **Visual Progress Tracking:** See which URLs are currently being processed with color-coded borders
- **Cancel Operation:** Stop bulk imports or scraping operations at any time with the Cancel button
- **Duplicate Detection:** Automatically prevents adding duplicate URLs to import lists
- **Memory Management:** Proper cleanup on window close prevents memory leaks

---

## Supported URLs

### ThePosterDB

| URL Type | Example | Description |
|----------|---------|-------------|
| **Set** | `https://theposterdb.com/set/12345` | Downloads all posters in a set |
| **Single Poster** | `https://theposterdb.com/poster/66055` | Finds and downloads the entire set from a single poster |
| **User Profile** | `https://theposterdb.com/user/username` | Downloads all uploads from a user |

### MediUX

| URL Type | Example | Description |
|----------|---------|-------------|
| **Set** | `https://mediux.pro/sets/24522` | Downloads all posters in a set with original quality |

> **Note:** MediUX downloads use direct API URLs for maximum image quality (~2MB originals instead of ~116KB compressed versions).

---

## Advanced Features

### Concurrent Processing

The tool supports parallel processing of multiple URLs simultaneously, dramatically improving import speed:

- **Configurable Workers:** Set worker count from 1 to your CPU core count (default: 3)
- **Visual Feedback:** Color-coded borders show processing status:
  - **Orange border** - Currently being processed
  - **Green border** - Successfully completed
  - **Red border** - Error occurred
- **Progress Tracking:** Real-time display of active workers and completion status
- **Cancel Anytime:** Stop operations mid-process with the Cancel button

**Performance Example:**
- Single-threaded: 9 URLs ≈ 90 seconds
- 3 workers: 9 URLs ≈ 30 seconds
- Maximum throughput with CPU-based worker scaling

### Bulk Import

Create a text file with one URL per line:

```text
# Movies
https://theposterdb.com/set/12345
https://mediux.pro/sets/24522

// TV Shows
https://theposterdb.com/set/67890
https://theposterdb.com/poster/11111
```

Lines starting with `#` or `//` are treated as comments and ignored.

**Run bulk import:**
```bash
python main.py bulk my_posters.txt
```

Or use the default file specified in `config.json`:
```bash
python main.py bulk
```

**Multiple Bulk Files:**
The GUI supports managing multiple bulk import files through a dropdown selector:
- Create new bulk files with the "New File" button
- Add existing .txt files (automatically detected and loaded)
- Switch between files without losing unsaved changes
- Delete files you no longer need (minimum 1 file retained)
- All files are tracked in `config.json` under `bulk_files` array
- Protection against accidentally overwriting existing files

### MediUX Filters

Control which types of media are downloaded from MediUX by editing the `mediux_filters` in `config.json`:

```json
"mediux_filters": ["poster", "backdrop", "title_card"]
```

**Available filters:**
- `poster` - Standard movie/show posters and season covers
- `backdrop` - Background/backdrop images  
- `title_card` - Episode title cards
- `season_cover` - Season-specific cover art
- `show_cover` - Show-level cover art
- `background` - Alternative background images

Remove any filter to skip that media type during import.

### Title Matching

The tool uses intelligent matching to find media in your Plex library:

**1. Manual Title Mappings** (Exact overrides)
For cases where poster source names don't match your Plex library, use `title_mappings` in `config.json`:

```json
"title_mappings": {
  "Pluribus": "PLUR1BUS",
  "The Office": "The Office (US)",
  "Star Wars Episode IV": "Star Wars"
}
```

When the scraper finds "Pluribus", it will automatically look for "PLUR1BUS" in your library.

**2. Fuzzy Matching** (Automatic fallback)
If exact matching fails, the tool automatically tries fuzzy matching with 80% similarity:
- "The Batman" might match "Batman (2022)"
- "Star Wars: A New Hope" might match "Star Wars Episode IV"

The tool will notify you when fuzzy matching is used: `ℹ Fuzzy matched 'Title A' to 'Title B'`

### Multiple Libraries

Apply posters to multiple Plex libraries simultaneously:

```json
{
  "movie_library": ["Movies", "4K Movies", "Kids Movies"],
  "tv_library": ["TV Shows", "Anime", "Kids TV"]
}
```

The tool will find and update the same media across all specified libraries.

---

## Building the Executable

A pre-built Windows executable is available in the `dist/` folder. To build it yourself:

1. **Install PyInstaller**
   ```bash
   pip install pyinstaller
   ```

2. **Build using the spec file**
   ```bash
   pyinstaller _PlexPosterSetHelper.spec
   ```

> **Tip:** Set `interactive_cli = False` in the main script before building to make the executable launch in GUI mode by default.

---

## Troubleshooting

### Linux-Specific Issues (Ubuntu/Debian/Unraid)

#### GUI Not Launching

**Problem:** Error when trying to launch GUI on Linux  
**Solutions:**
```bash
# Install tkinter for Python GUI support
sudo apt install python3-tk  # Ubuntu/Debian
```

For **Unraid** users, if using Python in a Docker container:
```bash
# Install tkinter in your container
apt-get update && apt-get install -y python3-tk
```

#### Display/X11 Errors

**Problem:** `_tkinter.TclError: no display name and no $DISPLAY environment variable`  
**Solutions:**

For headless servers (Unraid), use CLI mode instead:
```bash
python main.py cli
```

Or set up X11 forwarding if connecting via SSH:
```bash
# On your SSH connection
ssh -X user@server
export DISPLAY=:0
python main.py gui
```

For systems with Wayland display server:
```bash
export GDK_BACKEND=x11
python main.py gui
```

#### Chromium/Browser Not Found

**Problem:** `playwright._impl._api_types.Error: Executable doesn't exist`  
**Solutions:**

Install Playwright browsers:
```bash
# Option 1: Install Playwright browsers (recommended)
python -m playwright install chromium

# Option 2: Install system Chromium (Ubuntu/Debian)
sudo apt install chromium-browser

# Option 3: For Unraid Docker containers
docker exec -it <container-name> python -m playwright install chromium
docker exec -it <container-name> apt-get install -y chromium
```

If still having issues, install dependencies:
```bash
# Ubuntu/Debian
python -m playwright install-deps chromium

# Or manually install required libraries
sudo apt install -y libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
  libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2
```

#### Permission Denied Errors

**Problem:** Cannot create or write to config files  
**Solutions:**
```bash
# Check file permissions
ls -la config.json

# Fix ownership (replace 'user' with your username)
sudo chown user:user config.json bulk_import.txt
sudo chmod 664 config.json bulk_import.txt

# Or run from a directory with write permissions
cd ~/plex-poster-helper/
python main.py
```

For **Unraid** Docker containers, ensure volume mappings have correct permissions:
```bash
# In your Docker run command or compose file
-v /mnt/user/appdata/plex-poster-helper:/app/config

# Set permissions on the host
chmod -R 755 /mnt/user/appdata/plex-poster-helper
```

#### Python Version Issues

**Problem:** Wrong Python version or `python` command not found  
**Solutions:**
```bash
# Check Python version (must be 3.8+)
python3 --version

# Use python3 explicitly if python command doesn't work
python3 main.py

# Or create an alias
alias python=python3
echo "alias python=python3" >> ~/.bashrc
source ~/.bashrc
```

#### Package Installation Issues

**Problem:** pip install fails or packages not found  
**Solutions:**
```bash
# Ensure pip is installed
sudo apt install python3-pip

# Update pip
python3 -m pip install --upgrade pip

# Install requirements with user flag if permission denied
pip install --user -r requirements.txt

# Or use pip3 explicitly
pip3 install -r requirements.txt
```

For **Unraid** Docker setup, create a simple `Dockerfile`:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    python3-tk \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium

# Copy application
COPY . .

CMD ["python", "main.py", "cli"]
```

#### File Path Issues

**Problem:** Config or bulk import files not found  
**Solutions:**
```bash
# Always run from the project directory
cd /path/to/plex-poster-set-helper
python main.py

# Or use absolute paths in config.json
{
  "bulk_files": ["/home/user/plex-helper/bulk_import.txt"]
}

# Check current directory
pwd

# Verify files exist
ls -la config.json bulk_import.txt
```

#### Network/Firewall Issues

**Problem:** Cannot connect to Plex server or scraping sources  
**Solutions:**
```bash
# Test Plex server connection
curl http://your-plex-server:32400/identity

# Check if firewall is blocking
sudo ufw status
sudo ufw allow 32400/tcp  # If needed

# For Unraid, ensure Docker bridge network is configured
docker network inspect bridge
```

### "Poster set not found" Error

**Problem:** Error when using ThePosterDB single poster URLs  
**Solution:** This has been fixed in the latest version. The scraper now properly handles the updated page structure where set links are in tooltip elements.

### MediUX Images Not Downloading

**Problem:** Images appear blank or fail to download  
**Solution:** The scraper now uses direct API URLs (`https://api.mediux.pro/assets/`) instead of the Next.js proxy. Ensure you have network access to this domain.

### Posters Not Applying to Plex

**Problem:** Tool downloads posters but they don't appear in Plex  
**Solutions:**
- Verify library names in `config.json` match exactly (case-sensitive)
- Ensure media exists in Plex with matching titles and years
- Check that your Plex token has write permissions
- Confirm the Plex server is accessible at the configured URL

### Connection Errors

**Problem:** Cannot connect to scraping sources  
**Solutions:**
- Check your internet connection
- Ensure Playwright browser is properly installed: `playwright install chromium`
- Some networks may block automated access; try from a different network
- Check if the source website is accessible in your browser

### Operations Not Stopping

**Problem:** Cancel button doesn't immediately stop processing  
**Solution:** The cancel operation stops accepting new tasks and cancels pending futures, but currently running tasks must complete. This is expected behavior with ThreadPoolExecutor. Close the application window for immediate termination with proper cleanup.

### GUI Performance Issues

**Problem:** GUI becomes unresponsive during large imports  
**Solutions:**
- Reduce worker count to 1-2 for system with limited resources
- Process URLs in smaller batches
- Close other resource-intensive applications
- The progress indicators and cancel button should remain responsive during normal operation

### Media Not Found in Library

**Problem:** Tool reports media not found even though it exists  
**Solutions:**
- Verify the media title and year match between the poster source and Plex
- Check for special characters or formatting differences
- Ensure the media is properly scanned and visible in your Plex library
- Try refreshing metadata in Plex before running the tool

---

## Requirements

- **Python 3.8+**
- **Dependencies:** (automatically installed via `requirements.txt`)
  - `plexapi` - Plex API interaction
  - `requests` - HTTP requests
  - `beautifulsoup4` - HTML parsing
  - `playwright` - Modern web scraping
  - `customtkinter` - Modern GUI framework
  - `pillow` - Image processing

---

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

---

## License

This project is open source and available under the MIT License.

---

## Credits

- **ThePosterDB** - Community-driven poster database
- **MediUX** - High-quality media artwork source
- Built with ❤️ for the Plex community
