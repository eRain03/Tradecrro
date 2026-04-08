#!/usr/bin/env python3
"""
Tiger Open API Trading Bridge.
Executes real trades via Tiger Open API.

⚠️ WARNING: THIS EXECUTES REAL TRADES WITH REAL MONEY! ⚠️

Configuration:
- Uses config file at server/config/tiger_openapi_config.properties
- Or set TIGER_CONFIG_PATH environment variable

Actions:
  buy SYMBOL QUANTITY          - Market buy
  sell SYMBOL QUANTITY         - Market sell
  limit_buy SYMBOL QTY PRICE   - Limit buy order
  limit_sell SYMBOL QTY PRICE  - Limit sell order
  positions                    - Get current positions
  orders                       - Get open orders
  cancel ORDER_ID              - Cancel an order
  account                      - Get account info
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Optional

# ============================================================================
# SAFETY CHECKS
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


# Global trade client singleton
_trade_client = None


def _get_trade_client():
    """Initialize Tiger TradeClient (singleton pattern)."""
    global _trade_client

    if _trade_client is not None:
        return _trade_client

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

    _trade_client = TradeClient(client_config)
    return _trade_client


def action_buy(symbol: str, quantity: int) -> dict:
    """Execute market buy order."""
    client = _get_trade_client()

    try:
        # Market order: action='BUY', order_type='MKT'
        order = client.create_order(
            account=client.get_accounts()[0].account if client.get_accounts() else None,
            symbol=symbol,
            sec_type='STK',  # Stock
            action='BUY',
            quantity=quantity,
            order_type='MKT',  # Market order
        )
        result = client.place_order(order)

        return {
            "ok": True,
            "orderId": result.id if hasattr(result, 'id') else str(result),
            "symbol": symbol,
            "action": "BUY",
            "quantity": quantity,
            "orderType": "MARKET",
        }
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Buy order failed: {e}")


def action_sell(symbol: str, quantity: int) -> dict:
    """Execute market sell order."""
    client = _get_trade_client()

    try:
        order = client.create_order(
            account=client.get_accounts()[0].account if client.get_accounts() else None,
            symbol=symbol,
            sec_type='STK',
            action='SELL',
            quantity=quantity,
            order_type='MKT',
        )
        result = client.place_order(order)

        return {
            "ok": True,
            "orderId": result.id if hasattr(result, 'id') else str(result),
            "symbol": symbol,
            "action": "SELL",
            "quantity": quantity,
            "orderType": "MARKET",
        }
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Sell order failed: {e}")


def action_limit_buy(symbol: str, quantity: int, price: float) -> dict:
    """Execute limit buy order."""
    client = _get_trade_client()

    try:
        order = client.create_order(
            account=client.get_accounts()[0].account if client.get_accounts() else None,
            symbol=symbol,
            sec_type='STK',
            action='BUY',
            quantity=quantity,
            order_type='LMT',  # Limit order
            limit_price=price,
        )
        result = client.place_order(order)

        return {
            "ok": True,
            "orderId": result.id if hasattr(result, 'id') else str(result),
            "symbol": symbol,
            "action": "BUY",
            "quantity": quantity,
            "orderType": "LIMIT",
            "limitPrice": price,
        }
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Limit buy order failed: {e}")


def action_limit_sell(symbol: str, quantity: int, price: float) -> dict:
    """Execute limit sell order."""
    client = _get_trade_client()

    try:
        order = client.create_order(
            account=client.get_accounts()[0].account if client.get_accounts() else None,
            symbol=symbol,
            sec_type='STK',
            action='SELL',
            quantity=quantity,
            order_type='LMT',
            limit_price=price,
        )
        result = client.place_order(order)

        return {
            "ok": True,
            "orderId": result.id if hasattr(result, 'id') else str(result),
            "symbol": symbol,
            "action": "SELL",
            "quantity": quantity,
            "orderType": "LIMIT",
            "limitPrice": price,
        }
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Limit sell order failed: {e}")


def action_positions() -> list[dict]:
    """Get current positions."""
    client = _get_trade_client()

    try:
        positions = client.get_positions()
        results = []

        if positions is not None:
            for pos in positions:
                results.append({
                    "symbol": pos.symbol if hasattr(pos, 'symbol') else str(pos.get('symbol', '')),
                    "quantity": _to_int(pos.quantity if hasattr(pos, 'quantity') else pos.get('quantity', 0)),
                    "avgCost": _to_float(pos.average_cost if hasattr(pos, 'average_cost') else pos.get('average_cost', 0)),
                    "marketValue": _to_float(pos.market_value if hasattr(pos, 'market_value') else pos.get('market_value', 0)),
                    "unrealizedPnl": _to_float(pos.unrealized_pnl if hasattr(pos, 'unrealized_pnl') else pos.get('unrealized_pnl', 0)),
                })

        return results
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Get positions failed: {e}")


def action_orders() -> list[dict]:
    """Get open orders."""
    client = _get_trade_client()

    try:
        orders = client.get_open_orders()
        results = []

        if orders is not None:
            for order in orders:
                results.append({
                    "orderId": order.id if hasattr(order, 'id') else str(order.get('id', '')),
                    "symbol": order.symbol if hasattr(order, 'symbol') else str(order.get('symbol', '')),
                    "action": order.action if hasattr(order, 'action') else str(order.get('action', '')),
                    "quantity": _to_int(order.quantity if hasattr(order, 'quantity') else order.get('quantity', 0)),
                    "filledQuantity": _to_int(order.filled_quantity if hasattr(order, 'filled_quantity') else order.get('filled_quantity', 0)),
                    "orderType": order.order_type if hasattr(order, 'order_type') else str(order.get('order_type', '')),
                    "status": order.status if hasattr(order, 'status') else str(order.get('status', '')),
                    "limitPrice": _to_float(order.limit_price if hasattr(order, 'limit_price') else order.get('limit_price', 0)),
                })

        return results
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Get orders failed: {e}")


def action_cancel(order_id: str) -> dict:
    """Cancel an order."""
    client = _get_trade_client()

    try:
        result = client.cancel_order(order_id)
        return {
            "ok": True,
            "orderId": order_id,
            "cancelled": True,
        }
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Cancel order failed: {e}")


def action_account() -> dict:
    """Get account info."""
    client = _get_trade_client()

    try:
        accounts = client.get_accounts()
        if not accounts:
            return {"ok": False, "error": "No accounts found"}

        account = accounts[0]
        return {
            "ok": True,
            "accountId": account.account if hasattr(account, 'account') else str(account.get('account', '')),
            "accountType": account.type if hasattr(account, 'type') else str(account.get('type', '')),
            "netLiquidation": _to_float(account.net_liquidation if hasattr(account, 'net_liquidation') else account.get('net_liquidation', 0)),
            "cash": _to_float(account.cash if hasattr(account, 'cash') else account.get('cash', 0)),
            "buyingPower": _to_float(account.buying_power if hasattr(account, 'buying_power') else account.get('buying_power', 0)),
        }
    except Exception as e:
        _check_danger(str(e))
        _fail(f"Get account failed: {e}")


def main() -> None:
    if len(sys.argv) < 2:
        _fail("usage: tiger_trade.py ACTION [ARGS...]", 2)

    action = sys.argv[1].strip().lower()

    try:
        if action == "buy":
            if len(sys.argv) < 4:
                _fail("buy requires SYMBOL and QUANTITY arguments")
            symbol = sys.argv[2].strip().upper()
            quantity = int(sys.argv[3])
            result = action_buy(symbol, quantity)

        elif action == "sell":
            if len(sys.argv) < 4:
                _fail("sell requires SYMBOL and QUANTITY arguments")
            symbol = sys.argv[2].strip().upper()
            quantity = int(sys.argv[3])
            result = action_sell(symbol, quantity)

        elif action == "limit_buy":
            if len(sys.argv) < 5:
                _fail("limit_buy requires SYMBOL, QUANTITY, and PRICE arguments")
            symbol = sys.argv[2].strip().upper()
            quantity = int(sys.argv[3])
            price = float(sys.argv[4])
            result = action_limit_buy(symbol, quantity, price)

        elif action == "limit_sell":
            if len(sys.argv) < 5:
                _fail("limit_sell requires SYMBOL, QUANTITY, and PRICE arguments")
            symbol = sys.argv[2].strip().upper()
            quantity = int(sys.argv[3])
            price = float(sys.argv[4])
            result = action_limit_sell(symbol, quantity, price)

        elif action == "positions":
            result = action_positions()

        elif action == "orders":
            result = action_orders()

        elif action == "cancel":
            if len(sys.argv) < 3:
                _fail("cancel requires ORDER_ID argument")
            order_id = sys.argv[2].strip()
            result = action_cancel(order_id)

        elif action == "account":
            result = action_account()

        else:
            _fail(f"Unknown action: {action}")

        print(json.dumps(result))

    except SystemExit:
        raise
    except Exception as e:
        _fail(str(e))


if __name__ == "__main__":
    main()