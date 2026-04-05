import { DatabentoHistorical } from './DatabentoHistorical';

export type HistoricalRangeSource = DatabentoHistorical;

/**
 * 回测用历史 K 线：仅使用 Databento（需配置 DATABENTO_API_KEY）
 */
export function getHistoricalRangeSource(): HistoricalRangeSource {
  return new DatabentoHistorical();
}