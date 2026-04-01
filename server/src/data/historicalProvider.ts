import config from '../config';
import { DatabentoHistorical } from './DatabentoHistorical';
import { YahooFinanceClient } from './YahooFinanceClient';

export type HistoricalRangeSource = YahooFinanceClient | DatabentoHistorical;

/**
 * 回测用历史 K 线：若配置了 DATABENTO_API_KEY 则走 Databento（需 Python + pip install databento），否则 Yahoo。
 */
export function getHistoricalRangeSource(): HistoricalRangeSource {
  if (config.databento.apiKey.length > 0) {
    return new DatabentoHistorical();
  }
  return new YahooFinanceClient();
}
