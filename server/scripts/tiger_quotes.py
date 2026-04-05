#!/usr/bin/env python3
"""
Tiger Open API bridge for market data. Writes JSON to stdout.

⚠️ CRITICAL SAFETY - BLACKLIST PROTECTION ⚠️
Tiger will BLACKLIST accounts that violate rate limits or permissions!
This script has HARD-CODED protection that STOP IMMEDIATELY on danger signals.

DANGER KEYWORDS (will trigger immediate exit):
- "blacklist" / "black list"
- "permission denied"
- "rate limit"
- "code=4" (Tiger's rate limit code)

Rate Limits:
- High-frequency APIs (quotes): 120 requests/minute
- Low-frequency APIs: 10 requests/minute

Configuration:
- Uses config file at server/config/tiger_openapi_config.properties
- Or set TIGER_CONFIG_PATH environment variable
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

# ============================================================================
# HARDCODED DANGER KEYWORDS - DO NOT MODIFY
# These trigger IMMEDIATE termination to protect account
# ============================================================================
DANGER_KEYWORDS = [
    'blacklist',
    'black list',
    'permission denied',
    'rate limit',
    'code=4',
    'current limiting',
    '禁止',  # Chinese: forbidden
    '限制',  # Chinese: limit
    '黑名单',  # Chinese: blacklist
]

# Hardcoded exit codes
EXIT_BLACKLIST_THREAT = 99  # Special exit code for blacklist danger


def _check_danger(error_msg: str) -> None:
    """
    CRITICAL: Check if error indicates blacklist threat.
    STOP IMMEDIATELY to prevent account ban.
    This is HARDCODED and cannot be bypassed.
    """
    error_lower = error_msg.lower()

    for keyword in DANGER_KEYWORDS:
        if keyword.lower() in error_lower:
            # Print clear warning to stderr
            print("", file=sys.stderr)
            print("=" * 70, file=sys.stderr)
            print("🚫🚫🚫 BLACKLIST THREAT DETECTED 🚫🚫🚫", file=sys.stderr)
            print("=" * 70, file=sys.stderr)
            print(f"Error: {error_msg}", file=sys.stderr)
            print("PROGRAM TERMINATED TO PROTECT YOUR ACCOUNT!", file=sys.stderr)
            print("DO NOT MAKE ANY MORE API CALLS!", file=sys.stderr)
            print("=" * 70, file=sys.stderr)
            print("", file=sys.stderr)
            sys.exit(EXIT_BLACKLIST_THREAT)


def _fail(msg: str, code: int = 1) -> None:
    """Output error JSON and exit. Always checks for danger keywords first."""
    _check_danger(msg)  # Always check before any error output
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    raise SystemExit(code)


def _to_float(value: Any, fallback: float = 0.0) -> float:
    """Convert value to float, return fallback if invalid."""
    if value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _to_int(value: Any, fallback: int = 0) -> int:
    """Convert value to int, return fallback if invalid."""
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _get_client():
    """Initialize Tiger QuoteClient."""
    try:
        from tigeropen.quote.quote_client import QuoteClient
        from tigeropen.tiger_open_client import TigerOpenClientConfig
    except ImportError:
        _fail("Python package tigeropen is not installed. Run: pip install -r server/requirements-tiger.txt")

    # Check for config file path from environment or use default
    config_path = os.environ.get("TIGER_CONFIG_PATH", "").strip()

    if config_path and os.path.isfile(config_path):
        client_config = TigerOpenClientConfig(props_path=config_path)
    else:
        # Fallback: try to find config file in standard locations
        script_dir = os.path.dirname(os.path.abspath(__file__))
        default_paths = [
            os.path.join(script_dir, "../config/tiger_openapi_config.properties"),
            os.path.join(script_dir, "../../config/tiger_openapi_config.properties"),
            "./config/tiger_openapi_config.properties",
        ]

        for path in default_paths:
            if os.path.isfile(path):
                client_config = TigerOpenClientConfig(props_path=path)
                break
        else:
            _fail(f"Tiger config file not found. Set TIGER_CONFIG_PATH or place config at: {default_paths[0]}")

    return QuoteClient(client_config)


def _format_timestamp(ts: Any) -> str:
    """Format timestamp to ISO8601 string."""
    if ts is None:
        return ""
    try:
        if hasattr(ts, 'isoformat'):
            return ts.isoformat()
        # Tiger may return millisecond timestamp
        if isinstance(ts, (int, float)):
            # Convert milliseconds to datetime
            from datetime import datetime
            dt = datetime.fromtimestamp(ts / 1000)
            return dt.isoformat()
        return str(ts)
    except Exception:
        return str(ts)


def action_quotes(symbols: list[str]) -> list[dict]:
    """Get real-time quotes for symbols."""
    client = _get_client()

    try:
        df = client.get_stock_briefs(symbols)
    except Exception as e:
        # _fail will check for danger keywords
        _fail(f"get_stock_briefs failed: {e}")

    if df is None or len(df) == 0:
        return []

    results = []
    for _, row in df.iterrows():
        symbol = str(row.get("symbol", ""))
        price = _to_float(row.get("latest_price"))
        bid = _to_float(row.get("bid_price"), price)
        ask = _to_float(row.get("ask_price"), price)
        volume = _to_int(row.get("volume"))
        change = _to_float(row.get("change"))
        change_rate = _to_float(row.get("change_rate"))

        # Tiger's change_rate is percentage (e.g., 0.72 means 0.72%)
        change_percent = change_rate

        # Get timestamp
        ts = row.get("latest_time") or row.get("update_time") or row.get("time")
        timestamp = _format_timestamp(ts)

        results.append({
            "symbol": symbol,
            "price": price,
            "bid": bid,
            "ask": ask,
            "volume": volume,
            "timestamp": timestamp,
            "change": change,
            "changePercent": change_percent,
        })

    return results


def action_bars(symbol: str, period: str, start: str = None, end: str = None) -> list[dict]:
    """Get historical bars for a symbol."""
    client = _get_client()

    # Tiger periods: day, week, month, year, 1min, 5min, 15min, 30min, 60min
    try:
        df = client.get_bars(symbol, period)
    except Exception as e:
        _fail(f"get_bars failed: {e}")

    if df is None or len(df) == 0:
        return []

    # Filter by time range if provided
    if start and end:
        from datetime import datetime
        try:
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(end.replace('Z', '+00:00'))

            # Tiger's time column is millisecond timestamp
            if 'time' in df.columns:
                df = df[
                    (df['time'] >= int(start_dt.timestamp() * 1000)) &
                    (df['time'] <= int(end_dt.timestamp() * 1000))
                ]
        except Exception:
            pass  # Skip filtering if parsing fails

    results = []
    for _, row in df.iterrows():
        ts = row.get("time") or row.get("date")
        timestamp = _format_timestamp(ts)

        results.append({
            "date": timestamp,
            "open": _to_float(row.get("open")),
            "high": _to_float(row.get("high")),
            "low": _to_float(row.get("low")),
            "close": _to_float(row.get("close")),
            "volume": _to_int(row.get("volume")),
        })

    return results


def action_timeline(symbol: str) -> list[dict]:
    """Get intraday minute data for latest trading day."""
    client = _get_client()

    try:
        df = client.get_timeline(symbol)
    except Exception as e:
        _fail(f"get_timeline failed: {e}")

    if df is None or len(df) == 0:
        return []

    results = []
    for _, row in df.iterrows():
        ts = row.get("time")
        timestamp = _format_timestamp(ts)

        results.append({
            "date": timestamp,
            "open": _to_float(row.get("open")),
            "high": _to_float(row.get("high")),
            "low": _to_float(row.get("low")),
            "close": _to_float(row.get("close")),
            "volume": _to_int(row.get("volume")),
        })

    return results


def main() -> None:
    if len(sys.argv) < 2:
        _fail("usage: tiger_quotes.py ACTION [ARGS...]", 2)

    action = sys.argv[1].strip().lower()

    try:
        if action == "quotes":
            if len(sys.argv) < 3:
                _fail("quotes requires symbols argument (comma-separated)")
            symbols = [s.strip() for s in sys.argv[2].split(",") if s.strip()]
            if len(symbols) > 50:
                _fail(f"Too many symbols ({len(symbols)}), max 50 per request")
            result = action_quotes(symbols)

        elif action == "bars":
            if len(sys.argv) < 4:
                _fail("bars requires symbol and period arguments")
            symbol = sys.argv[2].strip()
            period = sys.argv[3].strip()
            start = sys.argv[4].strip() if len(sys.argv) > 4 else None
            end = sys.argv[5].strip() if len(sys.argv) > 5 else None
            result = action_bars(symbol, period, start, end)

        elif action == "timeline":
            if len(sys.argv) < 3:
                _fail("timeline requires symbol argument")
            symbol = sys.argv[2].strip()
            result = action_timeline(symbol)

        else:
            _fail(f"Unknown action: {action}")

        print(json.dumps(result))

    except SystemExit as e:
        # Re-raise SystemExit to preserve exit code
        raise
    except Exception as e:
        # Check for danger in any unexpected exception
        _fail(str(e))


if __name__ == "__main__":
    main()