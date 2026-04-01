# Trading Signal Audit Report (2026-04-01)

## Scope
- Backend signal pipeline and core rule implementation under `server/src`.
- Data source assumption: Yahoo Finance only (no broker connection).

## Key Fixes Applied In This Audit

1. **Score threshold bug fixed (64 → config-driven, default 87).**
   - `ScoringEngine` now reads `config.trading.scoreThreshold` instead of hardcoded `64`.

2. **Correlation-mode selection aligned to strategy semantics.**
   - Sync correlation contributes only when it is **negative**.
   - Lag correlation contributes only when it is **positive**.
   - Prevents strong positive synchronous correlation from incorrectly dominating strategy routing.

3. **Lookback window enforcement fixed in signal generation.**
   - Signal generation now requires `lookbackPoints + 1` price samples.
   - Returns are calculated and then trimmed to exact configured lookback length.
   - Volume averages now use the same lookback window rather than entire in-memory history.

4. **Historical memory window bounded to strategy window.**
   - Historical Yahoo preload now keeps only `lookbackPoints + 1` in memory.
   - Runtime update window uses the same bound.
   - Prevents dilution of short-horizon signal calculations with stale data.

5. **Position sizing guard bug fixed.**
   - `canOpenPosition(entryPrice)` now computes actual prospective position value from entry price and checks both per-position cap and total portfolio constraint.

## Compliance Check (Current State)

### Fully aligned
- Return-based correlation inputs.
- Lead/lag direction auto-detection (A→B and B→A search).
- Linear volume scoring with cap.
- Ask-on-buy / Bid-on-sell in simulator.

### Partially aligned / still needs work
1. **Yahoo granularity mismatch with strict 30-second requirement.**
   - Historical preload uses Yahoo 1-minute bars (platform limitation).
   - Live polling can run at 30s, but source quote updates may not always provide true 30s microstructure fidelity.

2. **Negative-correlation strategy execution path not fully dual-leg orchestrated.**
   - Exit rules support dual-leg semantics in `ExitManager`, but execution orchestration remains mostly single-trade oriented in simulation flow.

3. **TypeScript build baseline issue (pre-existing, not introduced by this patch).**
   - `YahooFinanceClient` import/type resolution fails under current TS module resolution settings.

## Recommended Next Steps
1. Add explicit "data quality mode" flag for Yahoo (`30s_target_with_1m_fallback`) and surface it in API/UI.
2. Implement explicit dual-leg order lifecycle manager for `negative_corr` strategy.
3. Normalize TS config/module resolution for `yahoo-finance2` to restore clean build.

