"""Centralized logging configuration for Plex Poster Set Helper.

This module provides a singleton logger that writes detailed debug information to a file
while displaying user-friendly messages in the console.

Usage:
    from src.core.logger import get_logger
    
    logger = get_logger()
    logger.info("User-facing information message")
    logger.debug("Detailed debug information (file only)")
    logger.warning("Warning message")
    logger.error("Error message")
    logger.exception("Error with full traceback")

Configuration:
    The log file path can be configured in config.json:
    {
        "log_file": "debug.log"  // Relative to executable or absolute path
    }
    
    The logger automatically:
    - Writes DEBUG and above to the log file with timestamps and context
    - Displays INFO and above in the console for user visibility
    - Creates a new session marker each time the app starts
"""

import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


class AppLogger:
    """Application logger with file and console output."""
    
    _instance: Optional['AppLogger'] = None
    _logger: Optional[logging.Logger] = None
    _log_file_path: Optional[str] = None
    
    def __new__(cls):
        """Singleton pattern to ensure only one logger instance."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        """Initialize the logger (only once)."""
        if AppLogger._logger is None:
            self._setup_logger()
    
    def _setup_logger(self, log_file: str = "debug.log", log_level: int = logging.DEBUG):
        """Set up the logger with file and console handlers.
        
        Args:
            log_file: Name or path of the log file.
            log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL).
        """
        # Create logger
        AppLogger._logger = logging.getLogger("PlexPosterHelper")
        AppLogger._logger.setLevel(log_level)
        
        # Prevent duplicate handlers
        if AppLogger._logger.handlers:
            AppLogger._logger.handlers.clear()
        
        # Determine log file path
        if not os.path.isabs(log_file):
            # Use the directory where the exe/script is located
            try:
                from ..utils.helpers import get_exe_dir
                log_dir = get_exe_dir()
            except Exception:
                log_dir = os.getcwd()
            
            AppLogger._log_file_path = os.path.join(log_dir, log_file)
        else:
            AppLogger._log_file_path = log_file
        
        # Ensure log directory exists
        log_dir = os.path.dirname(AppLogger._log_file_path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        
        # Create formatters
        detailed_formatter = logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        
        console_formatter = logging.Formatter(
            '%(levelname)s: %(message)s'
        )
        
        # File handler (detailed logging)
        try:
            file_handler = logging.FileHandler(
                AppLogger._log_file_path, 
                mode='a', 
                encoding='utf-8'
            )
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(detailed_formatter)
            AppLogger._logger.addHandler(file_handler)
            
            # Log session start
            AppLogger._logger.info("="*80)
            AppLogger._logger.info(f"NEW SESSION STARTED - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            AppLogger._logger.info("="*80)
        except Exception as e:
            print(f"Warning: Could not create log file at {AppLogger._log_file_path}: {e}")
        
        # Console handler (less verbose for user-facing output)
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)  # Only show INFO and above in console
        console_handler.setFormatter(console_formatter)
        AppLogger._logger.addHandler(console_handler)
    
    def configure(self, log_file: str = "debug.log", log_level: int = logging.DEBUG):
        """Reconfigure the logger with new settings.
        
        Args:
            log_file: Name or path of the log file.
            log_level: Logging level.
        """
        self._setup_logger(log_file, log_level)
    
    @property
    def logger(self) -> logging.Logger:
        """Get the logger instance."""
        if AppLogger._logger is None:
            self._setup_logger()
        return AppLogger._logger
    
    @property
    def log_file_path(self) -> Optional[str]:
        """Get the current log file path."""
        return AppLogger._log_file_path
    
    def debug(self, message: str, *args, **kwargs):
        """Log a debug message."""
        self.logger.debug(message, *args, **kwargs)
    
    def info(self, message: str, *args, **kwargs):
        """Log an info message."""
        self.logger.info(message, *args, **kwargs)
    
    def warning(self, message: str, *args, **kwargs):
        """Log a warning message."""
        self.logger.warning(message, *args, **kwargs)
    
    def error(self, message: str, *args, **kwargs):
        """Log an error message."""
        self.logger.error(message, *args, **kwargs)
    
    def critical(self, message: str, *args, **kwargs):
        """Log a critical message."""
        self.logger.critical(message, *args, **kwargs)
    
    def exception(self, message: str, *args, **kwargs):
        """Log an exception with traceback."""
        self.logger.exception(message, *args, **kwargs)


# Global logger instance
app_logger = AppLogger()


def get_logger() -> AppLogger:
    """Get the global logger instance.
    
    Returns:
        AppLogger instance.
    """
    return app_logger
