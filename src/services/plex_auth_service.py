"""Helper to obtain a Plex token via plexapi using user credentials.

This module exposes a simple function that attempts to authenticate against
Plex.tv using `plexapi` and returns an authentication token string on
success (or None and an error message on failure).
"""
from typing import Tuple, Optional

import time
import uuid
import requests
import xml.etree.ElementTree as ET
import os
import platform
import webbrowser
import json
import subprocess

from ..core.logger import get_logger

logger = get_logger()

def get_token_via_pin(open_browser: bool = True, timeout: int = 300, poll_interval: float = 2.0, progress_callback=None) -> Tuple[Optional[str], Optional[str], Optional[dict]]:
    """Start a Plex PIN (device) auth flow and return token on success.

    Flow:
    - POST to https://plex.tv/api/v2/pins to create a pin
    - Open the browser to https://plex.tv/link?code=<code> (user authorizes)
    - Poll GET https://plex.tv/api/v2/pins/<id> until <authToken> appears or timeout

    Returns (token, None, info) on success where info contains pin metadata.
    On failure returns (None, error_message, info_or_None).
    """
    pin_result = create_pin()
    if not pin_result or 'error' in pin_result:
        return None, pin_result.get('error') if pin_result else 'Failed to create PIN', None

    info = pin_result

    try:
        if callable(progress_callback):
            try:
                progress_callback(info)
            except Exception:
                logger.debug("progress_callback raised an exception", exc_info=True)
    except Exception:
        pass

    if open_browser:
        try:
            link_url = info.get('link')
            opened = webbrowser.open(link_url, new=2)
            if not opened and platform.system() == 'Windows':
                try:
                    subprocess.Popen(['cmd', '/c', 'start', "", link_url], shell=True)
                except Exception:
                    try:
                        os.startfile(link_url)
                    except Exception:
                        logger.warning("Fallback open methods failed for PIN link")
            logger.debug(f"Opened browser for PIN link: {link_url}")
        except Exception as e:
            logger.warning(f"Could not open browser automatically: {e}")

    return poll_pin(info.get('id'), client_id=info.get('client_id'), timeout=timeout, poll_interval=poll_interval)


def create_pin() -> Optional[dict]:
    """Create a Plex PIN and return info dict or {'error': msg} on failure."""
    try:
        client_id = uuid.uuid4().hex
        logger.debug("Creating Plex PIN (POST /api/v2/pins)")
        headers = {
            'X-Plex-Product': 'PlexPosterSetHelper',
            'X-Plex-Client-Identifier': client_id,
            'X-Plex-Device': 'PlexPosterSetHelper',
            'X-Plex-Version': '1.0'
        }

        resp = requests.post('https://plex.tv/api/v2/pins', headers=headers, timeout=15)
        resp.raise_for_status()

        resp_text = resp.text or ''
        logger.debug(f"PIN response status={resp.status_code} body={resp_text[:1000]}")

        pin_id = None
        pin_code = None
        expires = None

        # Try XML parsing first
        try:
            root = ET.fromstring(resp_text)
            pin_elem = root.find('pin') or root
            # Plex returns id/code as attributes on the <pin> element
            pin_id = pin_elem.findtext('id') or pin_elem.get('id')
            pin_code = pin_elem.findtext('code') or pin_elem.get('code')
            expires = pin_elem.findtext('expires_at') or pin_elem.get('expiresAt') or pin_elem.get('expires')
        except Exception:
            pass

        # If XML failed, try JSON
        if not pin_id:
            try:
                j = resp.json()
                # JSON may contain 'pin' object
                pin_obj = j.get('pin') if isinstance(j, dict) else None
                if pin_obj:
                    pin_id = pin_obj.get('id')
                    pin_code = pin_obj.get('code')
                    expires = pin_obj.get('expires_at') or pin_obj.get('expires')
                else:
                    # some responses may be flat
                    pin_id = j.get('id') if isinstance(j, dict) else None
                    pin_code = j.get('code') if isinstance(j, dict) else None
            except Exception:
                pass

        if not pin_id or not pin_code:
            logger.error(f"Failed to obtain PIN from Plex; resp={resp_text[:2000]}")
            return {'error': 'Failed to obtain PIN from Plex'}

        link_url = f'https://plex.tv/link?code={pin_code}'
        logger.debug(f"Created PIN id={pin_id} code={pin_code}")
        return {'id': pin_id, 'code': pin_code, 'expires_at': expires, 'link': link_url, 'client_id': client_id}
    except Exception as e:
        logger.exception(f"Error creating PIN: {e}")
        return {'error': str(e)}


def poll_pin(pin_id: str, client_id: Optional[str] = None, timeout: int = 300, poll_interval: float = 2.0) -> Tuple[Optional[str], Optional[str], Optional[dict]]:
    """Poll a previously-created PIN until an auth token is available.

    Returns (token, None, info) or (None, error, info).
    """
    try:
        if not client_id:
            client_id = uuid.uuid4().hex
        headers = {
            'X-Plex-Product': 'PlexPosterSetHelper',
            'X-Plex-Client-Identifier': client_id,
            'X-Plex-Device': 'PlexPosterSetHelper',
            'X-Plex-Version': '1.0'
        }

        logger.debug(f"Start polling PIN id={pin_id}")
        start = time.time()
        while True:
            if time.time() - start > timeout:
                logger.warning(f"PIN polling timed out for id={pin_id}")
                return None, 'Timed out waiting for user to authorize PIN', {'id': pin_id}

            poll_url = f'https://plex.tv/api/v2/pins/{pin_id}'
            try:
                r = requests.get(poll_url, headers=headers, timeout=10)
                logger.debug(f"Poll response status={r.status_code} body={r.text[:300]}")
                r.raise_for_status()
                root2 = ET.fromstring(r.text)
                pin2 = root2.find('pin') or root2
                # authToken may be an attribute or element
                auth_token = pin2.findtext('authToken') or pin2.findtext('auth_token') or pin2.get('authToken') or pin2.get('auth_token') or pin2.get('auth')
                if auth_token:
                    logger.info(f"Received auth token for PIN id={pin_id}")
                    info = {'id': pin_id}
                    return auth_token, None, info
            except Exception:
                # ignore transient errors and keep polling
                logger.debug(f"Transient polling error for PIN id={pin_id}, continuing", exc_info=True)
                pass

            time.sleep(poll_interval)
    except Exception as e:
        return None, str(e), {'id': pin_id}
