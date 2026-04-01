#!/usr/bin/env python3
"""
Fetch Databento OHLCV-1m bars for one symbol. Writes JSON array to stdout.

Environment:
  DATABENTO_API_KEY  (required)

Arguments:
  1: symbol (e.g. AAPL, raw_symbol)
  2: start ISO8601 (inclusive)
  3: end ISO8601 (exclusive per Databento)
  4: dataset (optional, default DBEQ.BASIC)

Requires: pip install databento
"""
from __future__ import annotations

import json
import os
import sys


def _fail(msg: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    raise SystemExit(code)


def main() -> None:
    if len(sys.argv) < 4:
        _fail("usage: databento_ohlcv.py SYMBOL START_ISO END_ISO [DATASET]", 2)

    key = os.environ.get("DATABENTO_API_KEY", "").strip()
    if not key:
        _fail("DATABENTO_API_KEY is not set")

    symbol = sys.argv[1].strip()
    start = sys.argv[2].strip()
    end = sys.argv[3].strip()
    dataset = sys.argv[4].strip() if len(sys.argv) > 4 else "DBEQ.BASIC"

    try:
        import databento as db  # type: ignore[import-untyped]
    except ImportError:
        _fail("Python package databento is not installed. Run: pip install -r server/requirements-databento.txt")

    try:
        client = db.Historical(key=key)
        store = client.timeseries.get_range(
            dataset=dataset,
            symbols=symbol,
            schema="ohlcv-1m",
            start=start,
            end=end,
            stype_in="raw_symbol",
            stype_out="instrument_id",
        )
        df = store.to_df()
    except Exception as e:
        _fail(str(e))

    if df is None or len(df) == 0:
        print(json.dumps([]))
        return

    # ts_event may be index or column
    if getattr(df.index, "name", None) == "ts_event" or "ts_event" not in df.columns:
        try:
            df = df.reset_index()
        except Exception:
            pass

    col_map = {str(c).lower(): c for c in df.columns}
    ts_col = col_map.get("ts_event") or col_map.get("timestamp")
    if ts_col is None:
        ts_col = list(df.columns)[0]

    out: list[dict] = []
    for _, row in df.iterrows():
        ts = row[ts_col]
        try:
            ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        except Exception:
            ts_iso = str(ts)

        def num(name: str) -> float:
            c = col_map.get(name)
            if c is None:
                return 0.0
            v = row[c]
            try:
                return float(v)
            except (TypeError, ValueError):
                return 0.0

        out.append(
            {
                "date": ts_iso,
                "open": num("open"),
                "high": num("high"),
                "low": num("low"),
                "close": num("close"),
                "volume": num("volume"),
            }
        )

    print(json.dumps(out))


if __name__ == "__main__":
    main()
