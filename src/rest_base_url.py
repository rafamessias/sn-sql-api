"""Derive the HTTPS origin for Instance REST APIs from a JDBC URL string."""

from __future__ import annotations

import re

_SERVICE_NOW_SUFFIX = ".service-now.com"


def _host_to_https_origin(host: str) -> str:
    raw = host.strip().strip("/")
    if not raw:
        raise ValueError("Empty host in JDBC URL.")
    lower = raw.lower()
    if lower.startswith("https://"):
        rest = raw[8:].split("/")[0]
        return f"https://{rest}"
    if lower.startswith("http://"):
        rest = raw[7:].split("/")[0]
        return f"https://{rest}"
    if "." not in raw:
        raw = f"{raw}{_SERVICE_NOW_SUFFIX}"
    return f"https://{raw}"


_NATIVE_AUTHORITY_RE = re.compile(
    r"jdbc:servicenow://(?:https?://)?([^/;:?\s]+)",
    re.IGNORECASE,
)
_SIMBA_SERVER_RE = re.compile(r"Server=https?://([^/;:?\s]+)", re.IGNORECASE)


def jdbc_url_to_https_origin(jdbc_url: str) -> str:
    """Return ``https://<instance>`` suitable for ``/api/now/table/...`` calls."""
    text = jdbc_url.strip()
    m = _NATIVE_AUTHORITY_RE.search(text)
    if m:
        return _host_to_https_origin(m.group(1))
    m2 = _SIMBA_SERVER_RE.search(text)
    if m2:
        return _host_to_https_origin(m2.group(1))
    raise ValueError(
        "Could not parse a ServiceNow host from the JDBC URL "
        "(expected native `jdbc:servicenow://…` or Simba `Server=https://…`).",
    )
