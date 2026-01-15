"""Data models for poster information."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class PosterInfo:
    """Information about a poster."""
    title: str
    url: str
    source: str
    year: Optional[int] = None
    season: Optional[any] = None  # Can be int, "Cover", or "Backdrop"
    episode: Optional[any] = None  # Can be int, "Cover", or None
    
    def is_tv_show(self) -> bool:
        """Check if poster is for a TV show."""
        return self.season is not None
    
    def is_movie(self) -> bool:
        """Check if poster is for a movie (not TV, not collection)."""
        return self.season is None and self.year is not None
    
    def is_collection(self) -> bool:
        """Check if poster is for a collection."""
        return self.season is None and self.year is None
