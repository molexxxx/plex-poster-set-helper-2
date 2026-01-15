"""Text parsing utilities."""

import re
from typing import List


def parse_urls(bulk_import_list: List[str]) -> List[str]:
    """Parse URLs from a list, filtering comments and empty lines.
    
    Args:
        bulk_import_list: List of URL strings.
        
    Returns:
        List of valid URLs.
    """
    valid_urls = []
    
    for line in bulk_import_list:
        url = line.strip()
        if url and not url.startswith(("#", "//")):
            valid_urls.append(url)
    
    return valid_urls


def is_comment(line: str) -> bool:
    """Check if line is a comment or empty.
    
    Args:
        line: Line to check.
        
    Returns:
        True if comment or empty, False otherwise.
    """
    line = line.strip()
    return not line or line.startswith(("#", "//"))
