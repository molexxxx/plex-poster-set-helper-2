"""Configuration management for the Plex Poster Set Helper."""

import json
import os
from typing import Dict, List, Any
from dataclasses import dataclass, asdict


@dataclass
class Config:
    """Configuration data class."""
    base_url: str = ""
    token: str = ""
    bulk_files: List[str] = None  # Support multiple bulk files
    tv_library: List[str] = None
    movie_library: List[str] = None
    mediux_filters: List[str] = None
    title_mappings: Dict[str, str] = None
    max_workers: int = 3
    log_file: str = "debug.log"  # Path to log file
    # Scraper delay settings
    scraper_min_delay: float = 0.1  # Minimum delay between requests (seconds)
    scraper_max_delay: float = 0.5  # Maximum delay between requests (seconds)
    scraper_initial_delay: float = 0.0  # Delay before first request (seconds)
    scraper_batch_delay: float = 2.0  # Extra delay every 10 requests (seconds)
    scraper_page_wait_min: float = 0.0  # Min wait for page JS execution (seconds)
    scraper_page_wait_max: float = 0.5  # Max wait for page JS execution (seconds)
    
    def __post_init__(self):
        """Initialize default values for mutable fields."""
        if self.tv_library is None:
            self.tv_library = ["TV Shows", "Anime"]
        if self.movie_library is None:
            self.movie_library = ["Movies"]
        if self.mediux_filters is None:
            self.mediux_filters = ["title_card", "background", "season_cover", "show_cover"]
        if self.title_mappings is None:
            self.title_mappings = {}
        if self.bulk_files is None:
            self.bulk_files = ["bulk_import.txt"]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return asdict(self)


class ConfigManager:
    """Manages application configuration."""
    
    def __init__(self, config_path: str = "config.json"):
        """Initialize the configuration manager.
        
        Args:
            config_path: Path to the configuration file.
        """
        # Ensure config_path is absolute for cross-platform compatibility
        if not os.path.isabs(config_path):
            from ..utils.helpers import get_exe_dir
            self.config_path = os.path.join(get_exe_dir(), config_path)
        else:
            self.config_path = config_path
        self._config: Config = None
    
    def load(self) -> Config:
        """Load configuration from file.
        
        Returns:
            Config object with loaded settings.
        """
        if not os.path.isfile(self.config_path):
            self._config = Config()
            self.save()
            print(f"Config file '{self.config_path}' created with default settings.")
            return self._config
        
        try:
            with open(self.config_path, "r") as config_file:
                data = json.load(config_file)
                self._config = Config(**data)
                return self._config
        except Exception as e:
            print(f"Error loading config: {str(e)}")
            self._config = Config()
            return self._config
    
    def save(self, config: Config = None) -> bool:
        """Save configuration to file.
        
        Args:
            config: Config object to save. If None, saves current config.
            
        Returns:
            True if saved successfully, False otherwise.
        """
        if config:
            self._config = config
        
        if not self._config:
            return False
        
        try:
            with open(self.config_path, "w") as f:
                json.dump(self._config.to_dict(), f, indent=4)
            return True
        except Exception as e:
            print(f"Error saving config: {str(e)}")
            return False
    
    @property
    def config(self) -> Config:
        """Get current configuration."""
        if not self._config:
            self.load()
        return self._config
    
    def update(self, **kwargs) -> bool:
        """Update configuration values.
        
        Args:
            **kwargs: Configuration fields to update.
            
        Returns:
            True if updated and saved successfully, False otherwise.
        """
        if not self._config:
            self.load()
        
        for key, value in kwargs.items():
            if hasattr(self._config, key):
                setattr(self._config, key, value)
        
        return self.save()
