class BaseHandler:
    """Base handler for CLI operations."""
    
    def __init__(self, cli_app):
        """Initialize the handler.
        
        Args:
            cli_app: The main PlexPosterCLI instance containing services and config.
        """
        self.app = cli_app
    
    @property
    def config(self):
        return self.app.config
        
    @property
    def config_manager(self):
        return self.app.config_manager
        
    @property
    def logger(self):
        return self.app.logger
        
    @property
    def plex_service(self):
        return self.app.plex_service
        
    @property
    def upload_service(self):
        return self.app.upload_service
        
    @property
    def scraper_factory(self):
        return self.app.scraper_factory
    
    def _check_libraries(self) -> bool:
        """Check if libraries are initialized."""
        return self.app._check_libraries()
