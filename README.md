# Statistical Arbitrage Trading System

基于统计套利的自动化期权交易系统 - Vue + Node.js + IG Markets

## 项目架构

```
├── client/          # Vue 3 + TypeScript 前端
│   ├── src/
│   │   ├── api/     # HTTP & WebSocket 客户端
│   │   ├── stores/  # Pinia 状态管理
│   │   └── views/   # 页面组件
│   └── ...
├── server/          # Node.js + TypeScript 后端
│   ├── src/
│   │   ├── core/    # 核心算法 (收益率、相关性、评分)
│   │   ├── trading/ # 交易引擎 (期权选择、模拟执行)
│   │   ├── ig/      # IG Markets API 集成
│   │   └── api/     # REST API 路由
│   └── ...
└── package.json     # 根目录工作区配置
```

## 核心策略

1. **数据层**: 30秒采样，30分钟回溯（60个数据点）
2. **收益率计算**: `r_t = (P_t - P_{t-1}) / P_{t-1}`
3. **双相关性系统**:
   - 负相关（同步）: `corr(A_t, B_t)`
   - 正相关（滞后5分钟）: `corr(A_t, B_{t+10})`
4. **评分系统**: 相关性(80分) + 成交量(20分)，≥87分触发交易
5. **策略类型**:
   - 正相关滞后套利: 买Lagger的CALL
   - 负相关波动套利: 买双CALL
6. **期权选择**: 基于流动性、敏感度、溢价效率评分
7. **执行规则**: Ask进，Bid出，10%仓位，+200%止盈/-50%止损


### 1. 安装依赖 better-of-sqllite

```bash
# 安装根目录依赖
npm install

# 安装前端依赖
cd client && npm install

# 安装后端依赖
cd server && npm install
```

### 2. 配置环境变量

```bash
cd server
cp .env.example .env

# 编辑 .env 文件，填入你的 IG API 凭证
IG_DEMO_API_KEY=your_api_key
IG_DEMO_USERNAME=your_username
IG_DEMO_PASSWORD=your_password
```

### 3. 启动开发服务器

```bash
# 同时启动前后端 (从根目录)
npm run dev

# 或分别启动
npm run dev:server  # 后端: http://localhost:3001
npm run dev:client  # 前端: http://localhost:5173
```

### 4. 访问应用

打开浏览器访问: http://localhost:5173

## 已实现功能

### Phase 1: 基础架构 ✅
- Vue 3 + TypeScript 前端项目
- Node.js + Express + TypeScript 后端
- SQLite 数据库 (本地)
- WebSocket 实时推送框架

### Phase 2: IG API 集成 ✅
- IGClient 认证模块
- 价格获取 (30秒轮询)
- 期权链获取
- WebSocket 实时数据流

### Phase 3: 核心算法 ✅
- 收益率计算模块 (30秒间隔，60点滑动窗口)
- 皮尔逊相关系数计算
- 滞后相关性检测 (双向Lead-Lag)
- 评分系统 (80分相关 + 20分成交量)
- 信号生成器 (≥87分触发)

### Phase 4: 模拟交易引擎 ✅
- 期权选择算法 (流动性+敏感度+效率评分)
- 模拟订单执行系统 (记录模拟成交价格)
- 仓位管理 (10%限制)
- 退出管理 (+200%止盈 / -50%止损)
- P&L 实时计算

### Phase 5: 前端界面 ✅
- 仪表盘 (评分、信号、持仓)
- 实时监控面板
- 策略配置页面
- 模拟交易历史/报表
- WebSocket实时数据连接

## 项目结构详解

### 核心算法文件

```
server/src/core/
├── data/
│   ├── ReturnCalculator.ts      # 收益率计算
│   ├── VolumeAnalyzer.ts        # 成交量分析
│   └── PriceFetcher.ts          # 价格获取
├── correlation/
│   ├── CorrelationCalculator.ts # 皮尔逊相关系数
│   ├── SyncCorrelation.ts       # 同步负相关
│   └── LagCorrelation.ts        # 滞后正相关
└── scoring/
    └── ScoringEngine.ts         # 评分系统
```

### 交易引擎文件

```
server/src/trading/
├── OptionSelector.ts       # 期权选择算法
├── SimulatedExecutor.ts    # 模拟交易执行器
├── PositionManager.ts      # 仓位管理
└── ExitManager.ts          # 退出管理
```

### IG API 集成

```
server/src/ig/
├── IGClient.ts             # IG API 客户端
├── IGStreamer.ts           # 价格流数据
└── OptionChainFetcher.ts   # 期权链获取
```

## 开发路线图

### Phase 1-5: 模拟交易版 ✅ 已完成

### Phase 6: 实盘切换 (计划中)
- [ ] 真实下单接口
- [ ] 更严格的风控（每日最大亏损、连续亏损停机）
- [ ] 邮件/短信告警

### Phase 7: 高级功能 (计划中)
- [ ] 多账户支持
- [ ] 机器学习优化期权选择
- [ ] 多市场支持

## 重要说明

⚠️ **本项目当前为模拟交易模式**
- 所有交易都是模拟的，不会使用真实资金
- 用于测试策略有效性
- 需要先在 IG 模拟账户中验证策略表现

## 技术栈

- **前端**: Vue 3 + TypeScript + Pinia + Tailwind CSS
- **后端**: Node.js + Express + TypeScript + WebSocket
- **数据库**: SQLite
- **API**: IG Markets REST + Streaming API

## 许可

MIT
