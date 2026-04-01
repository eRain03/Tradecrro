# StatArb 交易系统完整规范文档

## 一、核心思想

**本质**: 基于收益率（return）而非价格的统计套利 + 期权放大收益策略

**关键原则**:
- 计算相关性时使用百分比收益率序列，不是绝对价格
- 消除价格尺度差异，专注行为相关性
- 利用时间错位（lead-lag）和结构关系（correlation）作为 Alpha 来源

---

## 二、数据处理层

### 时间结构
- **采样间隔**: 30 秒
- **回溯窗口**: 30 分钟
- **数据点数量**: 60 个

### 收益率计算
```typescript
r_t = (P_t - P_{t-1}) / P_{t-1}
```

每个数据点代表 30 秒的涨跌幅

### 最终数据结构
```
Stock A: [r1, r2, r3, ..., r60]  // 60 个收益率
Stock B: [r1, r2, r3, ..., r60]
```

---

## 三、相关性评分系统

### A. 负相关（同步相关性）
- 计算：`corr(A_t, B_t)`
- 同一时间点对比
- 判断是否：A 涨→B 跌，A 跌→B 涨
- 典型值：接近 -1

### B. 正相关（滞后相关性）
- 滞后：5 分钟 = 10 个周期（@30 秒间隔）
- 计算：
  - `corr(A_t, B_{t+10})` — A 领先 B
  - `corr(B_t, A_{t+10})` — B 领先 A
- 选择更强的方向（自适应 leader/lagger）

### C. 相关性分数映射
```typescript
correlationScore = |correlation| × 80
```
| 相关性 | 分数 |
|--------|------|
| +1.0 或 -1.0 | 80 分 |
| 0.8 | 64 分 |
| 0.5 | 40 分 |
| 0.0 | 0 分 |

---

## 四、成交量评分系统（线性）

### 计算公式
```typescript
volumeRatio = currentVolume / averageVolume
volumeScore = min(max((ratio - 1) × 5, 0), 10)
```

### 映射关系
| Volume Ratio | Score |
|--------------|-------|
| 1.0 (正常) | 0 分 |
| 1.5 | 2.5 分 |
| 2.0 | 5 分 |
| 3.0+ | 10 分（封顶）|

### 总分计算
- 每只股票：0-10 分
- 一对股票：0-20 分（两只股票相加）

---

## 五、总评分系统

```typescript
totalScore = correlationScore (max 80) + volumeScore (max 20)
```

### 交易门槛
**必须 ≥ 87 分才允许交易**

这意味着：
- 完全相关 (80 分) + 正常成交量 (0 分) = 80 分 ❌
- 完全相关 (80 分) + 2 倍成交量 (10 分) = 90 分 ✅
- 强相关 (70 分) + 高成交量 (17 分) = 87 分 ✅

**设计意图**: 过滤假相关和低流动性噪音

---

## 六、策略类型与入场条件

### A. 正相关（滞后套利策略）

**本质**: leader 先动，lagger 跟随

**入场条件** (全部满足):
1. 强滞后相关性（分数≥87）
2. Leader 上涨 ≥ 5%
3. Lagger 上涨 < 2%
4. 预期波动 ≥ 5%

**交易行为**:
- 只买 **Lagger 的 CALL**
- 押注它会补涨

### B. 负相关（对冲波动套利）

**本质**: 不是方向性交易，而是波动率套利

**入场条件** (全部满足):
1. 强负相关（分数≥87）
2. 高成交量确认（至少一只股票 volume ratio ≥ 1.5）
3. 预期波动 ≥ 5%

**交易行为**:
- **同时买入两只股票的 CALL**
- 利用波动率爆发

---

## 七、期权选择系统（规则打分）

### 评估维度（每项 0-10 分，总分 30 分）

#### 1. 流动性 (Liquidity)
- 基于：成交量 + 买卖价差
```typescript
spreadScore = max(0, 5 - spreadPct × 2)
volumeScore = min(volume / 20, 5)
liquidityScore = spreadScore + volumeScore
```

#### 2. 敏感度 (Responsiveness)
- 基于：Delta（价格敏感度）
```typescript
if contract.delta:
    responsivenessScore = |delta| × 10
else:
    responsivenessScore = 5  // 默认值
```

#### 3. 溢价效率 (Efficiency)
- 基于：Moneyness（行权价/现货价）
- 偏好：ATM 或轻微 OTM

| Moneyness | Score |
|-----------|-------|
| 0.98-1.02 (ATM) | 10 分 |
| 0.95-1.05 (Near ATM) | 8 分 |
| 0.90-1.10 | 7 分 |
| 其他 | 4 分 |

### Strike 选择逻辑
- **优先**: ATM 或轻微 OTM Call
- 原因：平衡 affordability 和 responsiveness

### 最终选择
```typescript
totalScore = liquidity + responsiveness + efficiency (max 30)
选择分数最高的期权
```

---

## 八、执行价格规则

**关键原则**: 使用真实可成交价格

| 操作 | 价格类型 |
|------|----------|
| 买入 | ASK (卖一价) |
| 卖出 | BID (买一价) |

**禁止**: 使用 Last Price 计算收益（虚假盈利）

---

## 九、仓位管理

### 单一交易最大仓位
```typescript
maxPositionValue = portfolioValue × 10%
```

### 双腿交易（Pair Trade）
- 等资金分配
- 例如：$10,000 组合 → 每腿最多 $500

---

## 十、退出机制

### A. 正相关（单腿策略）
| 条件 | 阈值 |
|------|------|
| 止盈 | +200% (3 倍) |
| 止损 | -50% |

### B. 负相关（双腿策略）
| 条件 | 阈值 |
|------|------|
| 止盈 | 任意一腿达到 +200% |
| 止损 | **无** |

**退出行为**: 当一腿达到 +200%，**立即平仓两腿**

**设计意图**: 用一腿的盈利覆盖另一腿的亏损，赌波动率爆发

---

## 十一、AI 角色定义

### AI 可以做的
- 排序期权合约（ranking）
- 提高选择效率

### AI 禁止做的
- 覆盖交易规则
- 独立触发交易
- 修改阈值参数

**原则**: AI 是排序工具（ranking engine），不是决策者

---

## 十二、系统架构总结

### Alpha 来源
1. Lead-Lag 市场无效性
2. Cross-asset 相关性扭曲

### 放大器
- 期权杠杆（通常 3-5 倍 Delta）

### 风控机制
1. 高门槛（87 分）
2. 严格仓位（10%）
3. 明确退出（止盈/止损）

### 核心优势
同时利用：
1. 时间错位（lag）
2. 结构关系（correlation）
3. 波动率（volatility）
4. 杠杆（options）

---

## 十三、关键公式汇总

```typescript
// 收益率计算
return = (price_current - price_previous) / price_previous

// 相关性分数
correlationScore = |correlation| × 80

// 成交量分数
volumeRatio = current / average
volumeScore = min(max((ratio - 1) × 5, 0), 10)

// 总分
totalScore = correlationScore + volumeScoreA + volumeScoreB

// 入场检查（正相关）
leaderMove ≥ 5% && laggerMove < 2% && expectedMove ≥ 5%

// 期权选择
optionScore = liquidity(10) + responsiveness(10) + efficiency(10)

// P&L 计算（使用 BID 价格退出）
pnlPct = ((exitBid - entryAsk) / entryAsk) × 100
pnlAmount = pnlPct × positionSize
```

---

## 十四、文件结构

```
server/
├── src/
│   ├── core/
│   │   ├── correlation/
│   │   │   ├── CorrelationCalculator.ts  // Pearson 相关 + lead-lag 检测
│   │   │   ├── SyncCorrelation.ts        // 同步相关性
│   │   │   └── LagCorrelation.ts         // 滞后相关性（5 分钟）
│   │   ├── scoring/
│   │   │   └── ScoringEngine.ts          // 评分系统（80+20=100）
│   │   └── data/
│   │       ├── ReturnCalculator.ts       // 收益率计算
│   │       └── VolumeAnalyzer.ts         // 成交量评分（线性）
│   ├── strategy/
│   │   ├── SignalGenerator.ts            // 信号生成
│   │   └── EntryChecker.ts               // 入场条件检查
│   ├── trading/
│   │   ├── OptionSelector.ts             // 期权选择（30 分制）
│   │   ├── PositionManager.ts            // 仓位管理（10% 规则）
│   │   ├── ExitManager.ts                // 退出管理
│   │   └── SimulatedExecutor.ts          // 模拟执行（ASK 买/BID 卖）
│   └── config/
│       └── index.ts                      // 系统配置
```

---

## 十五、配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `SCORE_THRESHOLD` | 87 | 交易触发阈值 |
| `MAX_POSITION_PCT` | 10 | 最大仓位百分比 |
| `TAKE_PROFIT_PCT` | 200 | 止盈百分比 |
| `STOP_LOSS_PCT` | 50 | 止损百分比 |
| `SAMPLING_INTERVAL` | 30 | 采样间隔（秒） |
| `LOOKBACK_WINDOW` | 30 | 回溯窗口（分钟） |
| `LAG_INTERVALS` | 10 | 滞后周期数（=5 分钟） |

---

## 总结

该系统是一个**统计套利系统**，不是预测系统。

核心逻辑：
1. 识别强相关性股票对
2. 等待关系失衡（leader 先动，lagger 未动）
3. 买入期权押注回归
4. 严格风控（高门槛 + 仓位限制 + 止盈止损）

系统不预测市场方向，而是利用：
- 市场无效性（lead-lag）
- 结构性关系（correlation）
- 波动率扩张（volatility expansion）
