"""Socket-level backstop: if code bypasses the LeakGate SDK, the connection still fails.

    install(allow_hosts=(...), on_block=None) -> None     # loopback is always allowed
    install_for(gate) -> None                             # allow exactly the policy's destinations
    status() -> dict  {"installed", "blocked", "allowed_hosts", "last_blocked"}
    uninstall() / reset()                                 # tests only

It wraps socket.socket.connect / connect_ex, socket.create_connection and socket.getaddrinfo (a DNS
lookup of an outside name is itself a leak). Any destination that is not loopback and not allowed
raises OSError("LeakGate netguard: outbound connection to X blocked"), is counted, and is reported
to `on_block(dest)` (the API records it so the UI can show "bypass attempts").

Honest scope: covers code that goes through Python's socket module (requests, httpx, urllib, SDKs
built on them). Native extensions that open their own sockets are not intercepted; run agents in a
container with an egress proxy for that. The SDK layer (gate.inspect) is the part that understands
content; this layer only enforces "approved hosts only".
"""
from __future__ import annotations

import ipaddress
import socket
import threading

MAX_LAST = 10
_LOCK = threading.Lock()
_ORIG: dict = {}
_STATE = {"installed": False, "blocked": 0, "allowed_hosts": [], "last_blocked": []}
_HOOK: dict = {"on_block": None}


def _host_port(address) -> tuple[str | None, object]:
    if isinstance(address, tuple) and address:
        host = address[0].decode() if isinstance(address[0], bytes) else address[0]
        return host, address[1] if len(address) > 1 else None
    return None, None          # AF_UNIX path etc.: local by definition


def _allowed(host: str | None) -> bool:
    if host is None or host == "":
        return True
    h = str(host).strip("[]").split("%")[0].lower().rstrip(".")
    if h in _STATE["allowed_hosts"] or h == "localhost" or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False           # an outside hostname
    mapped = getattr(ip, "ipv4_mapped", None)
    return ip.is_loopback or bool(mapped and mapped.is_loopback)


def _block(host, port) -> None:
    dest = f"{host}:{port}" if port is not None else str(host)
    with _LOCK:
        _STATE["blocked"] += 1
        _STATE["last_blocked"] = (_STATE["last_blocked"] + [dest])[-MAX_LAST:]
    cb = _HOOK.get("on_block")
    if cb is not None:
        try:
            cb(dest)
        except Exception:
            pass
    raise OSError(f"LeakGate netguard: outbound connection to {dest} blocked")


def _connect(self, address):
    host, port = _host_port(address)
    if not _allowed(host):
        _block(host, port)
    return _ORIG["connect"](self, address)


def _connect_ex(self, address):
    host, port = _host_port(address)
    if not _allowed(host):
        _block(host, port)
    return _ORIG["connect_ex"](self, address)


def _create_connection(address, *args, **kwargs):
    host, port = _host_port(address)
    if not _allowed(host):
        _block(host, port)     # refuse BEFORE resolving, so no DNS query leaves either
    return _ORIG["create_connection"](address, *args, **kwargs)


def _getaddrinfo(host, port, *args, **kwargs):
    h = host.decode() if isinstance(host, bytes) else host
    if h is not None and not _allowed(h):
        try:
            ipaddress.ip_address(str(h).strip("[]").split("%")[0])   # an IP literal: no DNS, connect() decides
        except ValueError:
            _block(h, port)
    return _ORIG["getaddrinfo"](host, port, *args, **kwargs)


def install(allow_hosts=("127.0.0.1", "localhost", "::1"), on_block=None) -> None:
    """Patch the socket module (idempotent). Loopback is always allowed in addition to allow_hosts."""
    with _LOCK:
        _HOOK["on_block"] = on_block
        _STATE["allowed_hosts"] = [h.lower() for h in allow_hosts]
        if _STATE["installed"]:
            return
        _ORIG.update(connect=socket.socket.connect, connect_ex=socket.socket.connect_ex,
                     create_connection=socket.create_connection, getaddrinfo=socket.getaddrinfo)
        socket.socket.connect = _connect
        socket.socket.connect_ex = _connect_ex
        socket.create_connection = _create_connection
        socket.getaddrinfo = _getaddrinfo
        _STATE["installed"] = True


def uninstall() -> None:
    """Restore the original socket functions (tests only). Counters are kept; see reset()."""
    with _LOCK:
        if not _STATE["installed"]:
            return
        socket.socket.connect = _ORIG["connect"]
        socket.socket.connect_ex = _ORIG["connect_ex"]
        socket.create_connection = _ORIG["create_connection"]
        socket.getaddrinfo = _ORIG["getaddrinfo"]
        _STATE["installed"] = False


def reset() -> None:
    with _LOCK:
        _STATE.update(blocked=0, last_blocked=[])


def status() -> dict:
    with _LOCK:
        return {"installed": _STATE["installed"], "blocked": _STATE["blocked"],
                "allowed_hosts": list(_STATE["allowed_hosts"]), "last_blocked": list(_STATE["last_blocked"])}


def install_for(gate, on_block=None) -> None:
    """Allow exactly the hosts on the gate's policy (plus loopback)."""
    hosts = sorted({r.host.lower() for r in gate.policy.destinations})
    install(allow_hosts=tuple(hosts) + ("127.0.0.1", "localhost", "::1"), on_block=on_block)
