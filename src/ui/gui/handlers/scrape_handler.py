"""Handler for scraping and upload operations."""

import threading
from typing import List, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed


class ScrapeHandler:
    """Handles scraping and uploading operations."""
    
    def __init__(self, app):
        """Initialize scrape handler.
        
        Args:
            app: Main application instance.
        """
        self.app = app
        self.is_cancelled = False
        self.active_executor = None
    
    def process_scrape_urls(self, urls: List[str], row_list: list):
        """Process multiple URLs with concurrent scraping.
        
        Args:
            urls: List of URLs to scrape.
            row_list: List of UI rows for status updates.
        """
        try:
            self.app._setup_services()
            
            if not self.app.plex_service.tv_libraries and not self.app.plex_service.movie_libraries:
                self.app._update_status("Plex setup incomplete. Please configure your settings.", color="red")
                self.app._hide_progress()
                return
            
            total_urls = len(urls)
            max_workers = self.app.max_workers_var.get() if self.app.max_workers_var else 3
            
            self.is_cancelled = False
            self.app._update_status(f"Scraping {total_urls} URL(s) with {max_workers} worker(s)...", color="#E5A00D")
            self.app._update_progress(0, total_urls, active_count=max_workers)
            self.app._show_cancel_button()
            
            # Use ThreadPoolExecutor for concurrent scraping and uploading
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                self.active_executor = executor
                # Submit all URL scraping and upload tasks
                future_to_url = {executor.submit(self._scrape_and_upload_url, url): url for url in urls}
                
                print(f"📋 Submitted {len(urls)} URL processing tasks to {max_workers} concurrent workers")
                
                # Mark initial batch as processing
                initial_batch = min(max_workers, total_urls)
                for i in range(initial_batch):
                    self.app._set_url_row_status(urls[i], 'processing', row_list)
                
                completed = 0
                total_posters_uploaded = 0
                
                for future in as_completed(future_to_url):
                    if self.is_cancelled:
                        # Cancel all pending futures immediately
                        for f in future_to_url:
                            if not f.done():
                                f.cancel()
                        self.app._update_status(f"Operation cancelled. Processed {completed}/{total_urls} URLs.", color="#FF6B6B")
                        # Exit the with block to trigger executor shutdown
                        break
                    
                    url = future_to_url[future]
                    
                    # Calculate remaining active workers
                    remaining = total_urls - completed - 1
                    active_workers = min(remaining, max_workers)
                    
                    try:
                        poster_count, error = future.result()
                        
                        if error:
                            self.app._set_url_row_status(url, 'error', row_list)
                            print(f"⚠ {error}")
                        else:
                            self.app._set_url_row_status(url, 'completed', row_list)
                            total_posters_uploaded += poster_count
                        
                        completed += 1
                        
                        # Mark next URL as processing if there are more
                        next_index = completed + max_workers - 1
                        if next_index < total_urls:
                            self.app._set_url_row_status(urls[next_index], 'processing', row_list)
                        
                        self.app._update_progress(completed, total_urls, url, active_workers)
                        
                    except Exception as e:
                        self.app._set_url_row_status(url, 'error', row_list)
                        print(f"⚠ Exception: {str(e)}")
                        completed += 1
                        
                        # Still mark next URL as processing
                        next_index = completed + max_workers - 1
                        if next_index < total_urls:
                            self.app._set_url_row_status(urls[next_index], 'processing', row_list)
                        
                        remaining = total_urls - completed
                        active_workers = min(remaining, max_workers)
                        self.app._update_progress(completed, total_urls, url, active_workers)
            
            self.active_executor = None
            if not self.is_cancelled:
                self.app._update_status(f"✓ Processed {total_urls} URL(s) - Uploaded {total_posters_uploaded} posters!", color="#E5A00D")
            self.app._hide_progress()
        
        except Exception as e:
            self.app._hide_progress()
            self.app._update_status(f"Error: {e}", color="red")
        
        finally:
            self.app._enable_buttons()
    
    def _scrape_and_upload_url(self, url: str) -> Tuple[int, str]:
        """Scrape a single URL and upload all its posters.
        
        Args:
            url: URL to scrape and process.
            
        Returns:
            Tuple of (total_posters_uploaded, error_message or None)
        """
        try:
            print(f"🔍 [{threading.current_thread().name}] Starting scrape for: {url}")
            print(f"⏳ [{threading.current_thread().name}] Initializing secure browser...")
            movie_posters, show_posters, collection_posters = self.app.scraper_factory.scrape_url(url)
            print(f"📦 [{threading.current_thread().name}] Scraped {len(movie_posters)} movies, {len(show_posters)} shows, {len(collection_posters)} collections from: {url}")
            
            total_posters = len(movie_posters) + len(show_posters) + len(collection_posters)
            
            # Upload all posters from this URL
            for poster in collection_posters:
                self.app.upload_service.process_poster(poster)
            
            for poster in movie_posters:
                self.app.upload_service.process_poster(poster)
            
            for poster in show_posters:
                self.app.upload_service.process_poster(poster)
            
            print(f"✓ [{threading.current_thread().name}] Completed upload of {total_posters} posters from: {url}")
            return (total_posters, None)
        except Exception as e:
            error_msg = f"Error processing {url}: {str(e)}"
            print(f"✗ [{threading.current_thread().name}] {error_msg}")
            return (0, error_msg)
    
    def cancel(self):
        """Cancel ongoing operations."""
        self.is_cancelled = True
        if self.active_executor:
            try:
                self.active_executor.shutdown(wait=False, cancel_futures=True)
            except Exception as e:
                print(f"Error shutting down executor: {e}")
