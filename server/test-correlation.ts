/**
 * 相关性分数计算验证脚本
 *
 * 测试场景：
 * 1. 完全正相关 (correlation = 1.0) -> 分数应该是 80
 * 2. 完全负相关 (correlation = -1.0) -> 分数应该是 80
 * 3. 中度正相关 (correlation = 0.5) -> 分数应该是 40
 * 4. 不相关 (correlation = 0) -> 分数应该是 0
 * 5. 滞后正相关 -> 测试 lead-lag 检测
 */

import SyncCorrelation from './src/core/correlation/SyncCorrelation';
import LagCorrelation from './src/core/correlation/LagCorrelation';
import { ScoringEngine } from './src/core/scoring/ScoringEngine';
import ReturnCalculator from './src/core/data/ReturnCalculator';
import VolumeAnalyzer from './src/core/data/VolumeAnalyzer';

console.log('=== 相关性分数计算验证 ===\n');

const scoringEngine = new ScoringEngine();

// 测试辅助函数：生成价格序列
function generatePriceSeries(startPrice: number, returns: number[]): number[] {
  const prices = [startPrice];
  for (const r of returns) {
    prices.push(prices[prices.length - 1] * (1 + r));
  }
  return prices;
}

// 测试辅助函数：生成随机收益率
function generateRandomReturns(length: number, volatility: number = 0.02): number[] {
  const returns: number[] = [];
  for (let i = 0; i < length; i++) {
    returns.push((Math.random() - 0.5) * volatility);
  }
  return returns;
}

// ============================================
// 测试 1: 完全正相关
// ============================================
console.log('测试 1: 完全正相关 (A = B)');
const returns1 = generateRandomReturns(60, 0.02);
const returns1Copy = [...returns1];

const score1 = scoringEngine.calculatePairScore(
  'EUR/USD', 'EUR/USD',
  returns1, returns1Copy,
  1000, 1000, 1000, 1000
);

console.log(`  同步相关性：${score1.syncCorrelation.toFixed(4)}`);
console.log(`  滞后相关性：${score1.lagCorrelation.toFixed(4)}`);
console.log(`  相关性分数：${score1.correlationScore.toFixed(2)} / 80`);
console.log(`  成交量分数：${score1.volumeScore.toFixed(2)} / 20`);
console.log(`  总分：${score1.totalScore.toFixed(2)} / 100`);
console.log(`  是否达到阈值：${score1.meetsThreshold}`);
console.log('');

// ============================================
// 测试 2: 完全负相关 (B = -A)
// ============================================
console.log('测试 2: 完全负相关 (B = -A)');
const returns2A = generateRandomReturns(60, 0.02);
const returns2B = returns2A.map(r => -r);

const score2 = scoringEngine.calculatePairScore(
  'EUR/USD', 'USD/CHF',
  returns2A, returns2B,
  1000, 1000, 1000, 1000
);

console.log(`  同步相关性：${score2.syncCorrelation.toFixed(4)}`);
console.log(`  相关性分数：${score2.correlationScore.toFixed(2)} / 80`);
console.log(`  是否负相关：${score2.isNegativeCorr}`);
console.log(`  总分：${score2.totalScore.toFixed(2)} / 100`);
console.log(`  是否达到阈值：${score2.meetsThreshold}`);
console.log('');

// ============================================
// 测试 3: 不相关
// ============================================
console.log('测试 3: 不相关 (随机序列)');
const returns3A = generateRandomReturns(60, 0.02);
const returns3B = generateRandomReturns(60, 0.02);

const score3 = scoringEngine.calculatePairScore(
  'EUR/USD', 'GBP/JPY',
  returns3A, returns3B,
  1000, 1000, 1000, 1000
);

console.log(`  同步相关性：${score3.syncCorrelation.toFixed(4)}`);
console.log(`  相关性分数：${score3.correlationScore.toFixed(2)} / 80`);
console.log(`  总分：${score3.totalScore.toFixed(2)} / 100`);
console.log(`  是否达到阈值：${score3.meetsThreshold}`);
console.log('');

// ============================================
// 测试 4: 滞后正相关 (B 滞后 A 10 个周期)
// ============================================
console.log('测试 4: 滞后正相关 (B 滞后 A 10 个周期)');
// 生成 60 个随机收益率作为 A
const returns4A = generateRandomReturns(60, 0.02);
// B 滞后 A 10 个周期：B[10] = A[0], B[11] = A[1], ...
// 所以 B 的前 10 个值填充 0，后面是 A 的值
const returns4B = Array(10).fill(0).concat(returns4A.slice(0, 50));

console.log(`  A 长度：${returns4A.length}, B 长度：${returns4B.length}`);

const score4 = scoringEngine.calculatePairScore(
  'USD/JPY', 'EUR/JPY',
  returns4A, returns4B,
  1000, 1000, 1000, 1000
);

console.log(`  同步相关性：${score4.syncCorrelation.toFixed(4)}`);
console.log(`  滞后相关性：${score4.lagCorrelation.toFixed(4)}`);
console.log(`  相关性分数：${score4.correlationScore.toFixed(2)} / 80`);
console.log(`  是否正滞后：${score4.isPositiveLag}`);
console.log(`  Leader: ${score4.leader}`);
console.log(`  Lagger: ${score4.lagger}`);
console.log(`  总分：${score4.totalScore.toFixed(2)} / 100`);
console.log(`  是否达到阈值：${score4.meetsThreshold}`);
console.log('');

// ============================================
// 测试 5: 中度相关 (correlation ≈ 0.5)
// ============================================
console.log('测试 5: 中度相关 (B = 0.5*A + noise)');
const returns5A = generateRandomReturns(60, 0.02);
const noise = generateRandomReturns(60, 0.01);
const returns5B = returns5A.map((r, i) => 0.5 * r + noise[i]);

const score5 = scoringEngine.calculatePairScore(
  'EUR/GBP', 'EUR/JPY',
  returns5A, returns5B,
  1000, 1000, 1000, 1000
);

console.log(`  同步相关性：${score5.syncCorrelation.toFixed(4)}`);
console.log(`  相关性分数：${score5.correlationScore.toFixed(2)} / 80`);
console.log(`  总分：${score5.totalScore.toFixed(2)} / 100`);
console.log('');

// ============================================
// 测试 6: 成交量分数测试
// ============================================
console.log('测试 6: 成交量分数测试');

// 成交量正常 (ratio = 1.0)
const volumeScoreNormal = VolumeAnalyzer.calculateScore(1.0);
console.log(`  成交量正常 (ratio=1.0): ${volumeScoreNormal} / 10`);

// 成交量增加 (ratio = 2.0)
const volumeScoreHigh = VolumeAnalyzer.calculateScore(2.0);
console.log(`  成交量增加 (ratio=2.0): ${volumeScoreHigh} / 10`);

// 成交量减少 (ratio = 0.5)
const volumeScoreLow = VolumeAnalyzer.calculateScore(0.5);
console.log(`  成交量减少 (ratio=0.5): ${volumeScoreLow} / 10`);

// ============================================
// 测试 7: 分数明细
// ============================================
console.log('\n测试 7: 分数明细 (使用测试 1 的数据)');
const breakdown = scoringEngine.getScoreBreakdown(score1);
console.log(`  相关性：${breakdown.correlation.score.toFixed(2)} / ${breakdown.correlation.max} (${breakdown.correlation.pct.toFixed(1)}%)`);
console.log(`  成交量：${breakdown.volume.score.toFixed(2)} / ${breakdown.volume.max} (${breakdown.volume.pct.toFixed(1)}%)`);
console.log(`  总分：${breakdown.total.score.toFixed(2)} / ${breakdown.total.max} (${breakdown.total.pct.toFixed(1)}%)`);
console.log(`  阈值：${breakdown.threshold.score} - ${breakdown.threshold.met ? '已达到' : '未达到'}`);

console.log('\n=== 验证完成 ===');
