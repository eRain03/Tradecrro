/**
 * 文件名：yahoo_forex_fetcher.js
 * 作用：基于 Yahoo Finance API 获取外汇行情和历史数据
 * 说明：Yahoo Finance 免费、无需 API Key，但有速率限制
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. 配置区域
// ==========================================

// 默认监控的货币对（Yahoo Finance 格式）
const DEFAULT_CURRENCY_PAIRS = [
    'EURUSD=X',    // EUR/USD
    'GBPUSD=X',    // GBP/USD
    'USDJPY=X',    // USD/JPY
    'AUDUSD=X',    // AUD/USD
    'USDCAD=X',    // USD/CAD
    'USDCHF=X',    // USD/CHF
];

// 监控模式刷新间隔（毫秒）- 建议 >= 60000 避免触发限制
const MONITOR_INTERVAL = 60000;

// Yahoo Finance API 端点
const YAHOO_API = {
    QUOTE: 'https://query1.finance.yahoo.com/v8/finance/chart',
    HISTORY: 'https://query1.finance.yahoo.com/v8/finance/chart'
};

// 时间周期映射
const RANGE_MAP = {
    '1m': '1 分钟',
    '5m': '5 分钟',
    '15m': '15 分钟',
    '30m': '30 分钟',
    '60m': '1 小时',
    '90m': '1.5 小时',
    '1h': '1 小时',
    '1d': '1 天',
    '5d': '5 天',
    '1wk': '1 周',
    '1mo': '1 月',
    '3mo': '3 月',
    '6mo': '6 月',
    '1y': '1 年',
    '2y': '2 年',
    '5y': '5 年',
    '10y': '10 年',
    '1ytd': '年初至今',
};

// 数据存储器
let marketDataStore = {};

// ==========================================
// 2. 辅助函数
// ==========================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getTimestamp = () => {
    return new Date().toISOString().replace(/[:.]/g, '-');
};

const saveToJson = (data, filename) => {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`数据已保存到：${filepath}`);
    return filepath;
};

// ==========================================
// 3. 核心功能函数
// ==========================================

/**
 * 获取单个货币对的实时行情
 */
async function fetchQuote(symbol) {
    try {
        const response = await axios.get(`${YAHOO_API.QUOTE}/${symbol}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        const result = response.data.chart.result[0];
        if (!result || !result.meta) {
            return { error: 'No data available', symbol };
        }

        const meta = result.meta;
        const quote = result.meta.regularMarketPrice || meta.previousClose;

        return {
            symbol: symbol,
            name: meta.symbol,
            currency: meta.currency,
            price: quote,
            previousClose: meta.previousClose,
            open: meta.previousClose,
            dayHigh: meta.chartPreviousClose,
            dayLow: meta.chartPreviousClose,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        if (error.response?.status === 429) {
            return { error: 'Rate limit exceeded (429)', symbol };
        }
        return { error: error.message, symbol };
    }
}

/**
 * 获取历史数据
 * @param {string} symbol - 货币对符号（如 EURUSD=X）
 * @param {string} range - 时间范围（1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd）
 * @param {string} interval - 时间间隔（1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo）
 */
async function fetchHistory(symbol, range = '1mo', interval = '1d') {
    console.log(`\n正在获取历史数据：${symbol}`);
    console.log(`  时间范围：${range}`);
    console.log(`  时间间隔：${interval}`);

    try {
        const response = await axios.get(`${YAHOO_API.HISTORY}/${symbol}`, {
            params: { range, interval },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 15000
        });

        const result = response.data.chart.result[0];
        if (!result || !result.timestamp) {
            return { error: 'No data available', symbol, range, interval };
        }

        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];

        const historyData = timestamps.map((ts, i) => ({
            datetime: new Date(ts * 1000).toISOString(),
            timestamp: ts * 1000,
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i]
        })).filter(d => d.open !== null && d.close !== null);

        console.log(`✅ 成功获取 ${historyData.length} 条数据`);

        return {
            symbol,
            range,
            interval,
            count: historyData.length,
            data: historyData,
            meta: result.meta,
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        if (error.response?.status === 429) {
            console.log('❌ 触发速率限制，请稍后再试');
            return { error: 'Rate limit exceeded (429)', symbol, range, interval };
        }
        console.log(`❌ 获取失败：${error.message}`);
        return { error: error.message, symbol, range, interval };
    }
}

/**
 * 批量获取多个货币对行情
 */
async function fetchMultipleQuotes(symbols) {
    const results = [];
    console.log(`\n开始获取 ${symbols.length} 个货币对的行情...`);

    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        console.log(`[${i + 1}/${symbols.length}] 获取 ${symbol}...`);

        const data = await fetchQuote(symbol);
        results.push(data);

        // 添加延迟避免触发限制
        if (i < symbols.length - 1) {
            await sleep(1000);
        }
    }

    return results;
}

// ==========================================
// 4. 输出格式化
// ==========================================

function printQuoteSummary(results) {
    console.log('\n' + '='.repeat(70));
    console.log('实时行情摘要');
    console.log('='.repeat(70));

    const valid = results.filter(r => !r.error);
    const errors = results.filter(r => r.error);

    console.log(`✅ 成功：${valid.length}  |  ❌ 失败：${errors.length}`);
    console.log('-'.repeat(70));

    if (valid.length > 0) {
        console.log('货币对'.padEnd(15) + '价格'.padEnd(15) + '货币'.padEnd(10) + '时间');
        console.log('-'.repeat(70));

        valid.forEach(r => {
            const price = r.price?.toFixed(5) || 'N/A';
            const time = new Date(r.timestamp).toLocaleTimeString();
            console.log(`${r.symbol.padEnd(15)}${price.padEnd(15)}${(r.currency || 'USD').padEnd(10)}${time}`);
        });
    }

    if (errors.length > 0) {
        console.log('\n失败列表:');
        errors.forEach(r => {
            console.log(`  - ${r.symbol}: ${r.error}`);
        });
    }

    console.log('='.repeat(70));
}

function printHistorySummary(historyData) {
    if (historyData.error) {
        console.log(`\n❌ 获取历史数据失败：${historyData.error}`);
        return;
    }

    console.log('\n' + '='.repeat(70));
    console.log('历史数据摘要');
    console.log('='.repeat(70));
    console.log(`货币对：${historyData.symbol}`);
    console.log(`时间范围：${historyData.range}`);
    console.log(`间隔：${historyData.interval}`);
    console.log(`数据条数：${historyData.count}`);
    console.log('='.repeat(70));

    if (historyData.data && historyData.data.length > 0) {
        // 显示最新 5 条
        const recent = historyData.data.slice(-5).reverse();
        console.log('\n最近 5 条数据:');
        console.log('时间'.padEnd(25) + '开盘'.padEnd(12) + '最高'.padEnd(12) + '最低'.padEnd(12) + '收盘');
        console.log('-'.repeat(70));

        recent.forEach(d => {
            const time = d.datetime.replace('T', ' ').substring(0, 19);
            const open = d.open?.toFixed(5) || 'N/A';
            const high = d.high?.toFixed(5) || 'N/A';
            const low = d.low?.toFixed(5) || 'N/A';
            const close = d.close?.toFixed(5) || 'N/A';

            console.log(`${time.padEnd(25)}${open.padEnd(12)}${high.padEnd(12)}${low.padEnd(12)}${close}`);
        });

        // 统计
        const highs = historyData.data.map(d => d.high).filter(v => v !== null);
        const lows = historyData.data.map(d => d.low).filter(v => v !== null);

        console.log('\n统计信息:');
        console.log(`  期间最高：${Math.max(...highs).toFixed(5)}`);
        console.log(`  期间最低：${Math.min(...lows).toFixed(5)}`);
    }

    console.log('='.repeat(70));
}

// ==========================================
// 5. 功能模式函数
// ==========================================

/**
 * 模式 1：获取默认货币对行情
 */
async function fetchDefaultQuotes() {
    const results = await fetchMultipleQuotes(DEFAULT_CURRENCY_PAIRS);
    printQuoteSummary(results);

    const output = {
        mode: 'quotes',
        timestamp: getTimestamp(),
        count: results.length,
        data: results
    };
    saveToJson(output, `yahoo_quotes_${getTimestamp()}.json`);
}

/**
 * 模式 2：自定义货币对行情
 */
async function fetchCustomQuotes(input) {
    const symbols = input.split(',').map(s => s.trim()).filter(s => s);
    if (symbols.length === 0) {
        console.log('未输入有效的货币对');
        return;
    }
    const results = await fetchMultipleQuotes(symbols);
    printQuoteSummary(results);

    const output = {
        mode: 'quotes',
        timestamp: getTimestamp(),
        count: results.length,
        data: results
    };
    saveToJson(output, `yahoo_quotes_${getTimestamp()}.json`);
}

/**
 * 模式 3：获取历史数据
 */
async function fetchHistoryData(symbol, range, interval) {
    const targetSymbol = symbol || 'EURUSD=X';
    const targetRange = range || '1mo';
    const targetInterval = interval || '1d';

    const historyData = await fetchHistory(targetSymbol, targetRange, targetInterval);
    printHistorySummary(historyData);

    if (!historyData.error) {
        const output = {
            mode: 'history',
            ...historyData
        };
        saveToJson(output, `yahoo_history_${targetSymbol.replace('=X', '')}_${targetRange}_${targetInterval}_${getTimestamp()}.json`);
    }
}

/**
 * 模式 4：持续监控
 */
async function startMonitor(symbols) {
    const targetSymbols = symbols.length > 0 ? symbols : DEFAULT_CURRENCY_PAIRS;
    let iteration = 0;

    console.log('\n📊 进入持续监控模式');
    console.log(`监控标的：${targetSymbols.length} 个货币对`);
    console.log(`刷新间隔：${MONITOR_INTERVAL / 1000} 秒`);
    console.log('按 Ctrl+C 退出\n');

    const monitorLoop = async () => {
        iteration++;
        console.log(`\n--- 第 ${iteration} 次刷新 [${new Date().toLocaleTimeString()}] ---`);

        const results = await fetchMultipleQuotes(targetSymbols);
        marketDataStore[getTimestamp()] = results;
        printQuoteSummary(results);

        // 每 5 次保存一次
        if (iteration % 5 === 0) {
            saveToJson({
                mode: 'monitor',
                iterations: iteration,
                lastUpdate: getTimestamp(),
                data: results
            }, `yahoo_monitor_${getTimestamp()}.json`);
        }

        await sleep(MONITOR_INTERVAL);
        await monitorLoop();
    };

    await monitorLoop();
}

// ==========================================
// 6. 命令行交互
// ==========================================

function showMenu() {
    console.log('\n' + '='.repeat(60));
    console.log('Yahoo Finance 外汇行情工具');
    console.log('='.repeat(60));
    console.log('实时行情:');
    console.log('  1. 获取默认货币对行情');
    console.log('  2. 自定义货币对行情');
    console.log('\n历史数据:');
    console.log('  3. 获取历史数据');
    console.log('\n监控:');
    console.log('  4. 持续监控模式');
    console.log('\n其他:');
    console.log('  0. 退出');
    console.log('='.repeat(60));
}

async function handleUserInput() {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (question) => new Promise(resolve => {
        readline.question(question, resolve);
    });

    while (true) {
        showMenu();
        const choice = await ask('请选择功能 (0-4): ');

        switch (choice.trim()) {
            case '1':
                await fetchDefaultQuotes();
                break;
            case '2':
                const input = await ask('请输入货币对（如 EURUSD=X,GBPUSD=X）: ');
                await fetchCustomQuotes(input);
                break;
            case '3':
                const symbol = await ask('货币对 [默认：EURUSD=X]: ') || 'EURUSD=X';
                const range = await ask('时间范围 (1d,5d,1mo,3mo,6mo,1y) [默认：1mo]: ') || '1mo';
                const interval = await ask('间隔 (1m,5m,15m,30m,1h,1d,1wk) [默认：1d]: ') || '1d';
                await fetchHistoryData(symbol.trim(), range.trim(), interval.trim());
                break;
            case '4':
                await startMonitor([]);
                break;
            case '0':
                console.log('再见！');
                readline.close();
                process.exit(0);
            default:
                console.log('无效选择，请输入 0-4');
        }

        await sleep(1000);
    }
}

// ==========================================
// 7. 主程序入口
// ==========================================

async function main() {
    console.log('正在初始化 Yahoo Finance 外汇行情工具...\n');

    try {
        require.resolve('axios');
    } catch (e) {
        console.error('错误：缺少 axios 依赖，请运行：npm install axios');
        process.exit(1);
    }

    await handleUserInput();
}

main().catch(err => {
    console.error('程序异常:', err);
    process.exit(1);
});
