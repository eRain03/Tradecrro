#!/usr/bin/env python3
"""
Tiger Open API Options Trading Bridge.
Options chain retrieval and options order execution.

Configuration:
- Uses config file at server/config/tiger_openapi_config.properties
- Or set TIGER_CONFIG_PATH environment variable

Actions:
  chain SYMBOL              - Get option chain for symbol
  quote CONTRACT            - Get option quote (bid/ask/delta/gamma)
  buy CONTRACT QTY PRICE    - Buy to open option (limit order)
  sell CONTRACT QTY PRICE   - Sell to close option (limit order)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Optional, List, Dict

# ============================================================================
# Safety checks (shared with tiger_trade.py)
# ============================================================================
DANGER_KEYWORDS = [
    'blacklist',
    'black list',
    'forbidden',
    '禁止',
    '黑名单',
]

def _check_danger(error_msg: str) -> None:
    """Check if error indicates blacklist threat."""
    error_lower = error_msg.lower()
    for keyword in DANGER_KEYWORDS:
        if keyword.lower() in error_lower:
            print("", file=sys.stderr)
            print("=" * 70, file=sys.stderr)
            print("🚫🚫🚫 BLACKLIST THREAT DETECTED 🚫🚫🚫", file=sys.stderr)
            print("=" * 70, file=sys.stderr)
            print(f"Error: {error_msg}", file=sys.stderr)
            print("PROGRAM TERMINATED TO PROTECT YOUR ACCOUNT!", file=sys.stderr)
            print("=" * 70, file=sys.stderr)
            print("", file=sys.stderr)
            sys.exit(99)


def _fail(msg: str, code: int = 1) -> None:
    """Output error JSON and exit."""
    _check_danger(msg)
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    raise SystemExit(code)


def _to_float(value: Any, fallback: float = 0.0) -> float:
    if value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _to_int(value: Any, fallback: int = 0) -> int:
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


# Global client singleton
_option_client = None
_config_account = None


def _get_option_client():
    """Initialize Tiger OptionClient (singleton pattern)."""
    global _option_client, _config_account

    if _option_client is not None:
        return _option_client

    try:
        from tigeropen.trade.trade_client import TradeClient
        from tigeropen.tiger_open_client import TigerOpenClientConfig
    except ImportError:
        _fail("Python package tigeropen is not installed. Run: pip install -r server/requirements-tiger.txt")

    config_path = os.environ.get("TIGER_CONFIG_PATH", "").strip()

    if config_path and os.path.isfile(config_path):
        client_config = TigerOpenClientConfig(props_path=config_path)
    else:
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

    _config_account = client_config.account
    _option_client = TradeClient(client_config)
    return _option_client


def _get_account():
    """Get the configured account from config file."""
    _get_option_client()
    return _config_account


def action_chain(symbol: str) -> List[Dict]:
    """
    Get option chain for a symbol.
    Returns list of option contracts with key data.
    """
    client = _get_option_client()
    account = _get_account()

    try:
        # Get option chain using Tiger API
        # Note: Tiger API may use different method names
        # This is a placeholder - actual API may differ
        from tigeropen.quote.quote_client import QuoteClient
        from tigeropen.tiger_open_client import TigerOpenClientConfig

        config_path = os.environ.get("TIGER_CONFIG_PATH", "").strip()
        if not config_path:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            config_path = os.path.join(script_dir, "../config/tiger_openapi_config.properties")

        client_config = TigerOpenClientConfig(props_path=config_path)
        quote_client = QuoteClient(client_config)

        # Get option expiration dates first
        expirations = quote_client.get_option_expirations(symbol)

        if not expirations:
            print(json.dumps([]))
            return []

        # Get option chain for nearest expiration
        nearest_exp = expirations[0] if expirations else None

        if not nearest_exp:
            print(json.dumps([]))
            return []

        # Get option chain
        chain = quote_client.get_option_chain(symbol, nearest_exp)

        results = []
        for opt in chain:
            results.append({
                "contractSymbol": getattr(opt, 'symbol', ''),
                "underlying": symbol,
                "strike": _to_float(getattr(opt, 'strike', 0)),
                "expiration": str(getattr(opt, 'expiry', '')),
                "optionType": "CALL" if 'C' in getattr(opt, 'symbol', '') else "PUT",
                "bid": _to_float(getattr(opt, 'bid', 0)),
                "ask": _to_float(getattr(opt, 'ask', 0)),
                "lastPrice": _to_float(getattr(opt, 'latest_price', 0)),
                "volume": _to_int(getattr(opt, 'volume', 0)),
                "openInterest": _to_int(getattr(opt, 'open_interest', 0)),
                "delta": _to_float(getattr(opt, 'delta', 0)),
                "gamma": _to_float(getattr(opt, 'gamma', 0)),
                "theta": _to_float(getattr(opt, 'theta', 0)),
                "vega": _to_float(getattr(opt, 'vega', 0)),
                "impliedVolatility": _to_float(getattr(opt, 'implied_volatility', 0)),
            })

        print(json.dumps(results))
        return results

    except Exception as e:
        _check_danger(str(e))
        # Return empty array on error
        print(json.dumps([]))
        return []


def action_quote(contract_symbol: str) -> Dict:
    """
    Get option quote for a specific contract.
    Returns bid, ask, delta, gamma, etc.
    """
    client = _get_option_client()

    try:
        from tigeropen.quote.quote_client import QuoteClient
        from tigeropen.tiger_open_client import TigerOpenClientConfig

        config_path = os.environ.get("TIGER_CONFIG_PATH", "").strip()
        if not config_path:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            config_path = os.path.join(script_dir, "../config/tiger_openapi_config.properties")

        client_config = TigerOpenClientConfig(props_path=config_path)
        quote_client = QuoteClient(client_config)

        # Get option quote
        quote = quote_client.get_option_quote(contract_symbol)

        result = {
            "contractSymbol": contract_symbol,
            "bid": _to_float(getattr(quote, 'bid', 0)),
            "ask": _to_float(getattr(quote, 'ask', 0)),
            "lastPrice": _to_float(getattr(quote, 'latest_price', 0)),
            "delta": _to_float(getattr(quote, 'delta', 0)),
            "gamma": _to_float(getattr(quote, 'gamma', 0)),
            "theta": _to_float(getattr(quote, 'theta', 0)),
            "vega": _to_float(getattr(quote, 'vega', 0)),
            "impliedVolatility": _to_float(getattr(quote, 'implied_volatility', 0)),
        }

        print(json.dumps(result))
        return result

    except Exception as e:
        _check_danger(str(e))
        _fail(f"Failed to get option quote: {e}")


def action_buy(contract_symbol: str, quantity: int, limit_price: float) -> Dict:
    """
    Buy to open option contract.
    Uses limit order.
    """
    client = _get_option_client()
    account = _get_account()

    try:
        # Create option contract
        from tigeropen.trade.domain.contract import OptionContract

        # Parse contract symbol (e.g., "AAPL 240417C00180000")
        # Format: SYMBOL + YYMMDD + C/P + STRIKE * 1000
        contract = OptionContract()
        contract.symbol = contract_symbol
        contract.multiplier = 100  # Standard option multiplier

        # Create limit order
        order = client.create_order(
            account=account,
            contract=contract,
            action='BUY',
            order_type='LMT',
            quantity=quantity,
            limit_price=limit_price,
        )

        result = client.place_order(order)

        return {
            "ok": True,
            "orderId": str(getattr(result, 'id', '')),
            "contractSymbol": contract_symbol,
            "action": "BUY",
            "orderType": "LIMIT",
            "quantity": quantity,
            "limitPrice": limit_price,
        }

    except Exception as e:
        _check_danger(str(e))
        _fail(f"Option buy order failed: {e}")


def action_sell(contract_symbol: str, quantity: int, limit_price: float) -> Dict:
    """
    Sell to close option contract.
    Uses limit order.
    """
    client = _get_option_client()
    account = _get_account()

    try:
        from tigeropen.trade.domain.contract import OptionContract

        contract = OptionContract()
        contract.symbol = contract_symbol
        contract.multiplier = 100

        order = client.create_order(
            account=account,
            contract=contract,
            action='SELL',
            order_type='LMT',
            quantity=quantity,
            limit_price=limit_price,
        )

        result = client.place_order(order)

        return {
            "ok": True,
            "orderId": str(getattr(result, 'id', '')),
            "contractSymbol": contract_symbol,
            "action": "SELL",
            "orderType": "LIMIT",
            "quantity": quantity,
            "limitPrice": limit_price,
        }

    except Exception as e:
        _check_danger(str(e))
        _fail(f"Option sell order failed: {e}")


def main() -> None:
    if len(sys.argv) < 2:
        _fail("usage: tiger_options.py ACTION [ARGS...]", 2)

    action = sys.argv[1].strip().lower()

    try:
        if action == "chain":
            if len(sys.argv) < 3:
                _fail("chain requires SYMBOL argument")
            symbol = sys.argv[2].strip().upper()
            action_chain(symbol)

        elif action == "quote":
            if len(sys.argv) < 3:
                _fail("quote requires CONTRACT_SYMBOL argument")
            contract = sys.argv[2].strip().upper()
            action_quote(contract)

        elif action == "buy":
            if len(sys.argv) < 5:
                _fail("buy requires CONTRACT, QUANTITY, and PRICE arguments")
            contract = sys.argv[2].strip().upper()
            quantity = int(sys.argv[3])
            price = float(sys.argv[4])
            result = action_buy(contract, quantity, price)
            print(json.dumps(result))

        elif action == "sell":
            if len(sys.argv) < 5:
                _fail("sell requires CONTRACT, QUANTITY, and PRICE arguments")
            contract = sys.argv[2].strip().upper()
            quantity = int(sys.argv[3])
            price = float(sys.argv[4])
            result = action_sell(contract, quantity, price)
            print(json.dumps(result))

        else:
            _fail(f"Unknown action: {action}")

    except SystemExit:
        raise
    except Exception as e:
        _fail(str(e))


if __name__ == "__main__":
    main()