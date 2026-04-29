"""MSAID Platform API client — CHIMERYS chimeric spectrum deconvolution.

Implements authentication and result retrieval for the MSAID Platform
(platform.msaid.io).  CHIMERYS is a commercial AI-powered tool that
deconvolutes chimeric MS2 spectra, identifying multiple peptides per
spectrum via regularized linear regression over deep-learning-predicted
fragment intensities.

Authentication uses AWS Cognito OAuth2 (browser-based authorization-code
flow, mirroring the msaidPlatformR R SDK).  Results are returned as
Parquet files via S3 presigned URLs.

Typical workflow
----------------
1. User submits raw data (mzML / .d) to platform.msaid.io via the web UI.
2. CHIMERYS processes it; results appear as an "experiment" in the platform.
3. ZIGGY calls list_experiments() → user picks the relevant experiment.
4. ZIGGY calls download_results() → parquet is cached locally.
5. mobility_chimerys.py parses the parquet into ZIGGY's standard format.

References
----------
msaidPlatformR R SDK:  https://github.com/msaid-de/msaidPlatformR
CHIMERYS paper:        https://doi.org/10.1038/s41592-025-02663-w
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_DEFAULT_API_URL   = "https://api.platform.msaid.io"
_OAUTH_REDIRECT    = "http://localhost:8421/api/msaid/callback"
_TOKEN_CACHE_FILE  = Path.home() / ".stan" / "msaid_tokens.json"

# Result levels available from the platform
RESULT_LEVELS = [
    "PSMS",
    "PRECURSORS",
    "MODIFIED_PEPTIDES",
    "PEPTIDES",
    "PROTEIN_GROUPS",
    "SAMPLE_ROLLUP_PSMS",
    "SAMPLE_ROLLUP_PRECURSORS",
    "SAMPLE_ROLLUP_PEPTIDES",
    "SAMPLE_ROLLUP_PROTEIN_GROUPS",
]


# ── Token cache ────────────────────────────────────────────────────────────────

def _load_tokens(api_url: str) -> dict:
    try:
        if _TOKEN_CACHE_FILE.exists():
            data = json.loads(_TOKEN_CACHE_FILE.read_text())
            return data.get(api_url, {})
    except Exception:
        pass
    return {}


def _save_tokens(api_url: str, tokens: dict) -> None:
    _TOKEN_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        existing = {}
        if _TOKEN_CACHE_FILE.exists():
            existing = json.loads(_TOKEN_CACHE_FILE.read_text())
        existing[api_url] = tokens
        _TOKEN_CACHE_FILE.write_text(json.dumps(existing, indent=2))
    except Exception as e:
        logger.warning("Could not save MSAID tokens: %s", e)


def _clear_tokens(api_url: str) -> None:
    try:
        if _TOKEN_CACHE_FILE.exists():
            data = json.loads(_TOKEN_CACHE_FILE.read_text())
            data.pop(api_url, None)
            _TOKEN_CACHE_FILE.write_text(json.dumps(data, indent=2))
    except Exception:
        pass


# ── OAuth2 browser flow ────────────────────────────────────────────────────────

class _OAuthCallbackHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler that captures the Cognito redirect auth code."""

    auth_code: str | None = None
    server_error: str | None = None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "code" in params:
            _OAuthCallbackHandler.auth_code = params["code"][0]
            body = b"<html><body><h2>Login successful. Return to ZIGGY.</h2></body></html>"
        elif "error" in params:
            _OAuthCallbackHandler.server_error = params.get("error_description", ["unknown"])[0]
            body = b"<html><body><h2>Login failed. Check ZIGGY for details.</h2></body></html>"
        else:
            body = b"<html><body><h2>Waiting…</h2></body></html>"

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # suppress default request logging


def _start_callback_server(port: int = 8421) -> HTTPServer:
    server = HTTPServer(("localhost", port), _OAuthCallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


# ── Main client ────────────────────────────────────────────────────────────────

class MsaidPlatformClient:
    """Authenticated client for the MSAID Platform API.

    Parameters
    ----------
    api_url:
        Base URL of the MSAID Platform API.
        Default: ``https://api.platform.msaid.io``
    """

    def __init__(self, api_url: str = _DEFAULT_API_URL) -> None:
        self.api_url = api_url.rstrip("/")
        self._tokens: dict = _load_tokens(self.api_url)
        self._cognito_info: dict | None = None

    # ── Authentication ─────────────────────────────────────────────────────

    def _fetch_cognito_info(self) -> dict:
        """Fetch Cognito pool configuration from the platform."""
        if self._cognito_info:
            return self._cognito_info
        r = requests.get(f"{self.api_url}/v1/regions", timeout=15)
        r.raise_for_status()
        self._cognito_info = r.json()
        return self._cognito_info

    def _cognito_token_url(self) -> str:
        info = self._fetch_cognito_info()
        # mirrors R SDK: https://platform-prod-idp.auth.{region}.amazoncognito.com
        region = info.get("region", "eu-central-1")
        domain = info.get("cognitoDomain") or f"platform-prod-idp.auth.{region}.amazoncognito.com"
        return f"https://{domain}"

    def _cognito_client_id(self) -> str:
        info = self._fetch_cognito_info()
        return info.get("clientId", "")

    def _cognito_login_url(self) -> str:
        base = self._cognito_token_url()
        client_id = self._cognito_client_id()
        params = urllib.parse.urlencode({
            "client_id":     client_id,
            "response_type": "code",
            "redirect_uri":  _OAUTH_REDIRECT,
        })
        return f"{base}/login?{params}"

    def _exchange_code_for_tokens(self, auth_code: str) -> dict:
        token_url = f"{self._cognito_token_url()}/oauth2/token"
        data = {
            "grant_type":   "authorization_code",
            "client_id":    self._cognito_client_id(),
            "code":         auth_code,
            "redirect_uri": _OAUTH_REDIRECT,
        }
        r = requests.post(token_url, data=data, timeout=20)
        r.raise_for_status()
        return r.json()

    def _refresh_tokens(self) -> bool:
        """Attempt to refresh the id_token using the stored refresh_token."""
        refresh = self._tokens.get("refresh_token")
        if not refresh:
            return False
        try:
            token_url = f"{self._cognito_token_url()}/oauth2/token"
            data = {
                "grant_type":    "refresh_token",
                "client_id":     self._cognito_client_id(),
                "refresh_token": refresh,
            }
            r = requests.post(token_url, data=data, timeout=20)
            r.raise_for_status()
            new_tokens = r.json()
            self._tokens.update(new_tokens)
            _save_tokens(self.api_url, self._tokens)
            return True
        except Exception as e:
            logger.warning("Token refresh failed: %s", e)
            return False

    def login(self) -> None:
        """Start browser-based OAuth2 login.  Blocks until auth completes."""
        _OAuthCallbackHandler.auth_code = None
        _OAuthCallbackHandler.server_error = None

        server = _start_callback_server()
        login_url = self._cognito_login_url()
        logger.info("Opening MSAID login: %s", login_url)
        webbrowser.open(login_url)

        deadline = time.time() + 120  # 2-minute timeout
        while time.time() < deadline:
            if _OAuthCallbackHandler.auth_code:
                break
            if _OAuthCallbackHandler.server_error:
                server.shutdown()
                raise RuntimeError(f"MSAID login failed: {_OAuthCallbackHandler.server_error}")
            time.sleep(0.5)
        else:
            server.shutdown()
            raise TimeoutError("MSAID login timed out (120 s)")

        auth_code = _OAuthCallbackHandler.auth_code
        server.shutdown()

        tokens = self._exchange_code_for_tokens(auth_code)
        self._tokens = tokens
        _save_tokens(self.api_url, tokens)
        logger.info("MSAID Platform: logged in successfully")

    def logout(self) -> None:
        self._tokens = {}
        _clear_tokens(self.api_url)

    @property
    def is_authenticated(self) -> bool:
        return bool(self._tokens.get("id_token"))

    def _auth_header(self) -> dict:
        token = self._tokens.get("id_token", "")
        if not token:
            raise RuntimeError("Not authenticated. Call login() first.")
        return {"Authorization": f"Bearer {token}"}

    def _get(self, path: str, params: dict | None = None, retry: bool = True) -> Any:
        url = f"{self.api_url}{path}"
        r = requests.get(url, headers=self._auth_header(), params=params, timeout=30)
        if r.status_code == 401 and retry and self._refresh_tokens():
            return self._get(path, params=params, retry=False)
        r.raise_for_status()
        return r.json()

    # ── Experiment management ──────────────────────────────────────────────

    def list_experiments(
        self,
        page_size: int = 100,
        status: str | None = None,
    ) -> list[dict]:
        """Return all experiments visible to the authenticated user.

        Parameters
        ----------
        page_size: max items per page (platform limit: 100).
        status: filter by status, e.g. ``"COMPLETED"``.

        Returns
        -------
        List of experiment dicts with keys:
            uuid, name, description, status, createdAt, tags, sampleRollup.
        """
        results: list[dict] = []
        page = 0
        while True:
            params: dict = {"page": page, "pageSize": page_size}
            if status:
                params["filter"] = f"status=={status}"
            data = self._get("/v1/experiments", params=params)
            items = data if isinstance(data, list) else data.get("content", [])
            results.extend(items)
            if len(items) < page_size:
                break
            page += 1
        return results

    def get_experiment(self, experiment_uuid: str) -> dict:
        return self._get(f"/v1/experiments/experiment/{experiment_uuid}")

    # ── Result download ────────────────────────────────────────────────────

    def get_result_presigned_urls(
        self,
        experiment_uuid: str,
        level: str = "PRECURSORS",
        sample_rollup: bool = False,
    ) -> list[str]:
        """Fetch S3 presigned URLs for a result level's parquet file(s)."""
        if sample_rollup:
            path = (
                f"/v1/experiments/experiment/{experiment_uuid}"
                f"/results/sampleRollup/{level}/parquets/presignedUrls"
            )
        else:
            path = (
                f"/v1/experiments/experiment/{experiment_uuid}"
                f"/results/{level}/parquets/presignedUrls"
            )
        data = self._get(path)
        if isinstance(data, list):
            return data
        return data.get("urls", [data.get("url", "")])

    def download_results(
        self,
        experiment_uuid: str,
        level: str = "PRECURSORS",
        cache_dir: Path | None = None,
        sample_rollup: bool = False,
    ) -> Path:
        """Download Chimerys result parquet for ``level`` to ``cache_dir``.

        Returns the local Path of the downloaded parquet.
        """
        if cache_dir is None:
            cache_dir = Path.home() / ".stan" / "chimerys_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)

        suffix = "sampleRollup_" if sample_rollup else ""
        dest = cache_dir / f"{experiment_uuid}_{suffix}{level}.parquet"
        if dest.exists():
            logger.info("Chimerys result cache hit: %s", dest)
            return dest

        urls = self.get_result_presigned_urls(experiment_uuid, level, sample_rollup)
        if not urls:
            raise FileNotFoundError(
                f"No presigned URLs returned for experiment {experiment_uuid} / {level}"
            )

        logger.info("Downloading Chimerys results (%s)…", level)
        # For multi-part results, download and concatenate is handled by polars
        url = urls[0]
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
        logger.info("Chimerys result saved: %s (%.1f MB)", dest, dest.stat().st_size / 1e6)
        return dest

    def download_all_levels(
        self,
        experiment_uuid: str,
        cache_dir: Path | None = None,
    ) -> dict[str, Path]:
        """Download PSMs, PRECURSORS, PEPTIDES, and PROTEIN_GROUPS parquets."""
        out: dict[str, Path] = {}
        for level in ("PSMS", "PRECURSORS", "PEPTIDES", "PROTEIN_GROUPS"):
            try:
                out[level] = self.download_results(experiment_uuid, level, cache_dir)
            except Exception as e:
                logger.warning("Could not download %s: %s", level, e)
        return out


# ── Module-level convenience helpers ──────────────────────────────────────────

def get_client(api_url: str = _DEFAULT_API_URL) -> MsaidPlatformClient:
    """Return an authenticated client, refreshing tokens from cache."""
    return MsaidPlatformClient(api_url)
