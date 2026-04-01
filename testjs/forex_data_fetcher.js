/**
 * 文件名：forex_data_fetcher.js
 * 作用：基于 IG API 获取外汇行情数据
 * 功能：
 *   1. 获取指定货币对实时行情
 *   2. 批量获取多个货币对行情
 *   3. 自动发现可交易外汇对并获取行情
 *   4. 持续监控模式，定时刷新行情
 *   5. 获取历史数据（支持多种时间分辨率）
 *   6. 将数据保存为 JSON 文件
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. 配置区域
// ==========================================
const IG_CONFIG = {
    API_KEY: 'c9793f981071be87384ce1b4cd2d0c07614fc10e',
    IDENTIFIER: 'Dashwood',
    PASSWORD: 'Dashwood@123',
    BASE_URL: 'https://demo-api.ig.com/gateway/deal'
};

// 默认监控的货币对列表（可自定义）
const DEFAULT_CURRENCY_PAIRS = [
    'CS.D.EURUSD.MINI.IP',    // EUR/USD 迷你
    'CS.D.GBPUSD.MINI.IP',    // GBP/USD 迷你
    'CS.D.USDJPY.MINI.IP',    // USD/JPY 迷你
    'CS.D.AUDUSD.MINI.IP',    // AUD/USD 迷你
    'CS.D.USDCAD.MINI.IP',    // USD/CAD 迷你
    'CS.D.USDCHF.MINI.IP',    // USD/CHF 迷你
];

// 监控模式刷新间隔（毫秒）
const MONITOR_INTERVAL = 5000;

// 搜索关键字（用于自动发现外汇对）
const SEARCH_KEYWORDS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

// 历史数据配置
const HISTORY_RESOLUTIONS = {
    MINUTE_1: 'MINUTE_1',       // 1 分钟
    MINUTE_5: 'MINUTE_5',       // 5 分钟
    MINUTE_10: 'MINUTE_10',     // 10 分钟
    MINUTE_15: 'MINUTE_15',     // 15 分钟
    MINUTE_30: 'MINUTE_30',     // 30 分钟
    HOUR_1: 'HOUR_1',           // 1 小时
    HOUR_2: 'HOUR_2',           // 2 小时
    HOUR_3: 'HOUR_3',           // 3 小时
    HOUR_4: 'HOUR_4',           // 4 小时
    DAY_1: 'DAY_1',             // 1 天
    WEEK_1: 'WEEK_1',           // 1 周
    MONTH_1: 'MONTH_1'          // 1 月
};

// 默认历史数据获取配置
const HISTORY_CONFIG = {
    epic: 'CS.D.EURUSD.MINI.IP',
    resolution: HISTORY_RESOLUTIONS.HOUR_1,
    lookback: 24  // 获取过去 24 个时间点的数据
};

// 认证令牌（运行时存储）
let cstToken = '';
let securityToken = '';

// 数据存储器
let marketDataStore = {};
let discoveredEpics = [];

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
 * 登录 IG API 获取安全令牌
 */
async function loginToIG() {
    console.log('正在连接 IG API 并进行身份验证...');
    try {
        const response = await axios.post(`${IG_CONFIG.BASE_URL}/session`,
            {
                identifier: IG_CONFIG.IDENTIFIER,
                password: IG_CONFIG.PASSWORD
            },
            {
                headers: {
                    'X-IG-API-KEY': IG_CONFIG.API_KEY,
                    'Version': '2',
                    'Accept': 'application/json; charset=UTF-8',
                    'Content-Type': 'application/json; charset=UTF-8'
                }
            }
        );

        cstToken = response.headers['cst'];
        securityToken = response.headers['x-security-token'];

        if (!cstToken || !securityToken) {
            throw new Error('未能获取 CST 或 X-SECURITY-TOKEN');
        }

        console.log(`✅ 登录成功！账户 ID: ${response.data.currentAccountId}`);
        return true;
    } catch (error) {
        console.error('❌ 登录失败:', error.message);
        if (error.response) {
            console.error(`状态码：${error.response.status}`);
            console.error(`错误详情：${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

/**
 * 获取单个货币对的行情数据
 */
async function fetchSingleMarketData(epic) {
    try {
        const response = await axios.get(`${IG_CONFIG.BASE_URL}/markets/${epic}`, {
            headers: {
                'X-IG-API-KEY': IG_CONFIG.API_KEY,
                'CST': cstToken,
                'X-SECURITY-TOKEN': securityToken,
                'Version': '1',
                'Accept': 'application/json; charset=UTF-8'
            }
        });

        const data = response.data;
        return {
            epic: epic,
            name: data.instrument?.name || 'N/A',
            instrumentType: data.instrument?.instrumentType || 'N/A',
            bid: data.snapshot?.bid || null,
            offer: data.snapshot?.offer || null,
            high: data.snapshot?.high || null,
            low: data.snapshot?.low || null,
            change: data.snapshot?.change || null,
            marketStatus: data.snapshot?.marketStatus || 'N/A',
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`❌ 获取 ${epic} 数据失败：${error.message}`);
        return {
            epic: epic,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * 批量获取多个货币对的行情数据
 */
async function fetchMultipleMarketData(epics) {
    const results = [];
    console.log(`\n开始获取 ${epics.length} 个货币对的行情数据...`);

    for (let i = 0; i < epics.length; i++) {
        const epic = epics[i];
        console.log(`[${i + 1}/${epics.length}] 获取 ${epic}...`);

        const data = await fetchSingleMarketData(epic);
        results.push(data);

        // 添加延迟避免触发速率限制
        if (i < epics.length - 1) {
            await sleep(500);
        }
    }

    return results;
}

/**
 * 获取历史价格数据
 * @param {string} epic - 交易品种代码
 * @param {string} resolution - 时间分辨率（如 HOUR_1, DAY_1 等）
 * @param {number} lookback - 获取多少个时间点的数据
 * @returns {Promise<Array>} 历史数据数组
 */
async function fetchHistoricalData(epic, resolution = HISTORY_RESOLUTIONS.HOUR_1, lookback = 24) {
    console.log(`\n正在获取历史数据...`);
    console.log(`  品种：${epic}`);
    console.log(`  分辨率：${resolution}`);
    console.log(`  数据点数：${lookback}`);

    try {
        // IG API 历史数据端点：/prices/{epic}/{resolution}/{lookback}
        // 注意：此功能需要实盘账户，Demo 账户可能不支持
        const response = await axios.get(`${IG_CONFIG.BASE_URL}/prices/${epic}/${resolution}/${lookback}`, {
            headers: {
                'X-IG-API-KEY': IG_CONFIG.API_KEY,
                'CST': cstToken,
                'X-SECURITY-TOKEN': securityToken,
                'Version': '1',
                'Accept': 'application/json; charset=UTF-8'
            }
        });

        const prices = response.data.prices || [];
        const historicalData = prices.map(price => ({
            timestamp: price.timestamp,
            datetime: new Date(parseInt(price.timestamp)).toISOString(),
            bidHigh: price.bidHigh,
            bidLow: price.bidLow,
            bidOpen: price.bidOpen,
            bidClose: price.bidClose,
            offerHigh: price.offerHigh,
            offerLow: price.offerLow,
            offerOpen: price.offerOpen,
            offerClose: price.offerClose,
            lastTradedVolume: price.lastTradedVolume || null
        }));

        console.log(`✅ 成功获取 ${historicalData.length} 条历史数据`);

        return {
            epic: epic,
            resolution: resolution,
            lookback: lookback,
            count: historicalData.length,
            data: historicalData,
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error(`❌ 获取历史数据失败：${error.message}`);
        if (error.response) {
            console.error(`状态码：${error.response.status}`);
            const errData = error.response.data;
            console.error(`错误详情：${JSON.stringify(errData)}`);

            if (error.response.status === 400 && errData.errorCode === 'Invalid parameter') {
                console.log('\n💡 提示：历史数据 API 可能需要实盘账户才能使用。');
                console.log('   Demo 账户可能不支持此功能。');
            }
        }
        return {
            epic: epic,
            resolution: resolution,
            error: error.message,
            statusCode: error.response?.status,
            fetchedAt: new Date().toISOString()
        };
    }
}

/**
 * 获取多个时间分辨率的历史数据
 */
async function fetchMultiResolutionHistory(epic, resolutions = [HISTORY_RESOLUTIONS.HOUR_1, HISTORY_RESOLUTIONS.DAY_1]) {
    const results = {};

    for (const resolution of resolutions) {
        console.log(`\n--- 获取 ${resolution} 分辨率的历史数据 ---`);
        const data = await fetchHistoricalData(epic, resolution, HISTORY_CONFIG.lookback);
        results[resolution] = data;
        await sleep(500); // 避免触发速率限制
    }

    return results;
}

/**
 * 导出历史数据为 CSV 格式
 */
function exportHistoryToCsv(historyData, filename) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (!historyData.data || historyData.data.length === 0) {
        console.log('没有可导出的数据');
        return null;
    }

    const headers = ['datetime', 'bidOpen', 'bidHigh', 'bidLow', 'bidClose', 'offerOpen', 'offerHigh', 'offerLow', 'offerClose', 'volume'];
    const rows = historyData.data.map(d => [
        d.datetime,
        d.bidOpen,
        d.bidHigh,
        d.bidLow,
        d.bidClose,
        d.offerOpen,
        d.offerHigh,
        d.offerLow,
        d.offerClose,
        d.lastTradedVolume || ''
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, csvContent, 'utf-8');
    console.log(`CSV 数据已保存到：${filepath}`);
    return filepath;
}

/**
 * 打印历史数据摘要
 */
function printHistorySummary(historyData) {
    if (historyData.error) {
        console.log(`\n❌ 获取历史数据失败：${historyData.error}`);
        return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('历史数据摘要');
    console.log('='.repeat(80));
    console.log(`品种：${historyData.epic}`);
    console.log(`分辨率：${historyData.resolution}`);
    console.log(`数据条数：${historyData.count}`);
    console.log('='.repeat(80));

    if (historyData.data && historyData.data.length > 0) {
        // 显示最新 5 条数据
        const recent = historyData.data.slice(-5).reverse();
        console.log('\n最近 5 条数据:');
        console.log('时间'.padEnd(25) + '买价 (Bid)'.padEnd(15) + '卖价 (Bid)'.padEnd(15) + '成交量');
        console.log('-'.repeat(80));

        recent.forEach(d => {
            const time = d.datetime.replace('T', ' ').substring(0, 19);
            const bidPrice = ((d.bidClose || d.bidOpen) || 0).toFixed(5);
            const offerPrice = ((d.offerClose || d.offerOpen) || 0).toFixed(5);
            const volume = d.lastTradedVolume || 'N/A';

            console.log(`${time.padEnd(25)}${bidPrice.padEnd(15)}${offerPrice.padEnd(15)}${volume}`);
        });

        // 统计信息
        const bidHigh = Math.max(...historyData.data.map(d => d.bidHigh));
        const bidLow = Math.min(...historyData.data.map(d => d.bidLow));
        const avgVolume = historyData.data.filter(d => d.lastTradedVolume).reduce((sum, d) => sum + d.lastTradedVolume, 0) / historyData.data.filter(d => d.lastTradedVolume).length;

        console.log('\n统计信息:');
        console.log(`  期间最高买价：${bidHigh.toFixed(5)}`);
        console.log(`  期间最低买价：${bidLow.toFixed(5)}`);
        console.log(`  平均成交量：${avgVolume ? avgVolume.toFixed(2) : 'N/A'}`);
    }

    console.log('='.repeat(80));
}

/**
 * 搜索包含关键字的可交易市场
 */
async function searchMarketsByKeyword(keyword) {
    try {
        const response = await axios.get(`${IG_CONFIG.BASE_URL}/markets?searchTerm=${keyword}`, {
            headers: {
                'X-IG-API-KEY': IG_CONFIG.API_KEY,
                'CST': cstToken,
                'X-SECURITY-TOKEN': securityToken,
                'Version': '1',
                'Accept': 'application/json; charset=UTF-8'
            }
        });

        const markets = response.data.markets || [];
        const foundEpics = [];

        markets.forEach(market => {
            if (market.marketStatus === 'TRADEABLE') {
                const isDuplicate = discoveredEpics.some(e => e.epic === market.epic);
                if (!isDuplicate) {
                    discoveredEpics.push({
                        epic: market.epic,
                        name: market.instrumentName,
                        type: market.instrumentType
                    });
                    foundEpics.push(market.epic);
                }
            }
        });

        return foundEpics.length;
    } catch (error) {
        console.error(`❌ 搜索 ${keyword} 失败：${error.message}`);
        return 0;
    }
}

/**
 * 自动发现所有可交易的外汇货币对
 */
async function discoverAllForexPairs() {
    console.log('\n🔍 开始自动发现可交易外汇对...');
    discoveredEpics = [];

    for (const keyword of SEARCH_KEYWORDS) {
        const count = await searchMarketsByKeyword(keyword);
        if (count > 0) {
            console.log(`  搜索 "${keyword}": 发现 ${count} 个新品种`);
        }
        await sleep(1000); // 严格遵守速率限制
    }

    // 筛选出外汇货币对（通常包含 FX 或标准货币对格式）
    const forexPairs = discoveredEpics.filter(item => {
        const name = item.name.toUpperCase();
        // 匹配常见外汇对格式
        return name.includes('/') || name.includes('USD') || name.includes('EUR') || name.includes('GBP') || name.includes('JPY');
    });

    console.log(`\n✅ 发现完成！共计 ${forexPairs.length} 个可交易外汇对`);
    return forexPairs.map(item => item.epic);
}

// ==========================================
// 4. 功能模式函数
// ==========================================

/**
 * 模式 1：获取指定货币对行情
 */
async function fetchSpecifiedPairs(pairs) {
    if (!await loginToIG()) return;

    const epics = pairs.length > 0 ? pairs : DEFAULT_CURRENCY_PAIRS;
    const results = await fetchMultipleMarketData(epics);

    const output = {
        mode: 'specified',
        timestamp: getTimestamp(),
        count: results.length,
        data: results
    };

    saveToJson(output, `forex_data_${getTimestamp()}.json`);
    printSummary(results);
}

/**
 * 模式 2：自动发现 + 获取所有外汇对行情
 */
async function discoverAndFetch() {
    if (!await loginToIG()) return;

    const forexEpics = await discoverAllForexPairs();

    if (forexEpics.length === 0) {
        console.log('未发现可交易的外汇对');
        return;
    }

    // 分批获取，避免过长的等待
    console.log(`\n开始获取 ${forexEpics.length} 个外汇对的行情...`);
    const results = await fetchMultipleMarketData(forexEpics);

    const output = {
        mode: 'discover_and_fetch',
        timestamp: getTimestamp(),
        totalCount: discoveredEpics.length,
        fetchedCount: results.length,
        discoveredMarkets: discoveredEpics,
        marketData: results
    };

    saveToJson(output, `forex_data_full_${getTimestamp()}.json`);
    printSummary(results);
}

/**
 * 模式 3：持续监控模式
 */
async function startMonitor(pairs) {
    if (!await loginToIG()) return;

    const epics = pairs.length > 0 ? pairs : DEFAULT_CURRENCY_PAIRS;
    let iteration = 0;

    console.log('\n📊 进入持续监控模式');
    console.log(`监控标的：${epics.length} 个货币对`);
    console.log(`刷新间隔：${MONITOR_INTERVAL / 1000} 秒`);
    console.log('按 Ctrl+C 退出\n');

    const monitorLoop = async () => {
        iteration++;
        console.log(`\n--- 第 ${iteration} 次刷新 [${new Date().toLocaleTimeString()}] ---`);

        const results = await fetchMultipleMarketData(epics);

        marketDataStore[getTimestamp()] = results;
        printSummary(results);

        // 每 10 次刷新保存一次数据
        if (iteration % 10 === 0) {
            saveToJson({
                mode: 'monitor',
                iterations: iteration,
                lastUpdate: getTimestamp(),
                data: results
            }, `forex_monitor_${getTimestamp()}.json`);
        }

        await sleep(MONITOR_INTERVAL);
        await monitorLoop();
    };

    await monitorLoop();
}

/**
 * 模式 4：获取历史数据
 */
async function fetchHistoryData(epic, resolution, lookback, saveCsv) {
    if (!await loginToIG()) return;

    const targetEpic = epic || HISTORY_CONFIG.epic;
    const targetResolution = resolution || HISTORY_CONFIG.resolution;
    const targetLookback = lookback || HISTORY_CONFIG.lookback;

    const historyData = await fetchHistoricalData(targetEpic, targetResolution, targetLookback);

    // 保存 JSON
    const output = {
        mode: 'history',
        epic: targetEpic,
        resolution: targetResolution,
        lookback: targetLookback,
        ...historyData
    };

    saveToJson(output, `forex_history_${targetEpic.replace(/\./g, '_')}_${targetResolution}_${getTimestamp()}.json`);

    // 可选保存 CSV
    if (saveCsv) {
        exportHistoryToCsv(historyData, `forex_history_${targetEpic.replace(/\./g, '_')}_${targetResolution}_${getTimestamp()}.csv`);
    }

    printHistorySummary(historyData);
}

/**
 * 模式 5：获取多种分辨率的历史数据
 */
async function fetchMultiResolutionHistoryData(epic, lookback) {
    if (!await loginToIG()) return;

    const targetEpic = epic || HISTORY_CONFIG.epic;
    const targetLookback = lookback || HISTORY_CONFIG.lookback;

    const resolutions = [
        HISTORY_RESOLUTIONS.MINUTE_5,
        HISTORY_RESOLUTIONS.HOUR_1,
        HISTORY_RESOLUTIONS.HOUR_4,
        HISTORY_RESOLUTIONS.DAY_1
    ];

    console.log('\n📈 开始获取多时间周期历史数据...');
    console.log(`品种：${targetEpic}`);
    console.log(`数据点数：${targetLookback}`);
    console.log(`分辨率：${resolutions.join(', ')}`);

    const results = await fetchMultiResolutionHistory(targetEpic, resolutions);

    const output = {
        mode: 'multi_resolution_history',
        epic: targetEpic,
        lookback: targetLookback,
        resolutions: resolutions,
        data: results,
        fetchedAt: getTimestamp()
    };

    saveToJson(output, `forex_multi_history_${targetEpic.replace(/\./g, '_')}_${getTimestamp()}.json`);

    // 为每种分辨率打印摘要
    for (const resolution of resolutions) {
        if (results[resolution]) {
            printHistorySummary(results[resolution]);
        }
    }
}

// ==========================================
// 5. 输出格式化
// ==========================================

function printSummary(results) {
    console.log('\n' + '='.repeat(80));
    console.log('行情数据摘要');
    console.log('='.repeat(80));

    const validResults = results.filter(r => !r.error);
    const errorResults = results.filter(r => r.error);

    console.log(`✅ 成功：${validResults.length}  |  ❌ 失败：${errorResults.length}`);
    console.log('-'.repeat(80));

    if (validResults.length > 0) {
        console.log('货币对'.padEnd(25) + '买价 (Bid)'.padEnd(15) + '卖价 (Offer)'.padEnd(15) + '状态');
        console.log('-'.repeat(80));

        validResults.forEach(r => {
            const name = r.name || r.epic;
            const bid = r.bid ? r.bid.toFixed(5) : 'N/A';
            const offer = r.offer ? r.offer.toFixed(5) : 'N/A';
            const status = r.marketStatus || 'N/A';

            console.log(
                name.substring(0, 24).padEnd(25) +
                bid.padEnd(15) +
                offer.padEnd(15) +
                status
            );
        });
    }

    if (errorResults.length > 0) {
        console.log('\n失败列表:');
        errorResults.forEach(r => {
            console.log(`  - ${r.epic}: ${r.error}`);
        });
    }

    console.log('='.repeat(80));
}

// ==========================================
// 6. 命令行交互
// ==========================================

function showMenu() {
    console.log('\n' + '='.repeat(60));
    console.log('IG 外汇行情数据获取工具');
    console.log('='.repeat(60));
    console.log('实时行情:');
    console.log('  1. 获取默认货币对行情');
    console.log('  2. 自定义货币对行情（输入 EPIC 代码）');
    console.log('  3. 自动发现 + 获取所有外汇对行情');
    console.log('  4. 持续监控模式');
    console.log('\n历史数据:');
    console.log('  5. 获取历史数据');
    console.log('  6. 获取多分辨率历史数据');
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
        const choice = await ask('请选择功能 (0-6): ');

        switch (choice.trim()) {
            case '1':
                await fetchSpecifiedPairs([]);
                break;
            case '2':
                const input = await ask('请输入 EPIC 代码（多个用逗号分隔）: ');
                const pairs = input.split(',').map(s => s.trim()).filter(s => s);
                if (pairs.length > 0) {
                    await fetchSpecifiedPairs(pairs);
                } else {
                    console.log('未输入有效的 EPIC 代码');
                }
                break;
            case '3':
                await discoverAndFetch();
                break;
            case '4':
                await startMonitor([]);
                break;
            case '5':
                // 获取历史数据
                const epic = await ask(`请输入 EPIC 代码 [默认：${HISTORY_CONFIG.epic}]: `);
                const resolution = await ask(`请输入时间分辨率 (如 HOUR_1, DAY_1) [默认：${HISTORY_CONFIG.resolution}]: `);
                const lookback = await ask(`请输入数据点数 [默认：${HISTORY_CONFIG.lookback}]: `);
                const saveCsvAns = await ask('是否导出 CSV 文件？(y/n) [默认：n]: ');

                const validResolutions = Object.values(HISTORY_RESOLUTIONS);
                const targetResolution = validResolutions.includes(resolution.trim()) ? resolution.trim() : HISTORY_CONFIG.resolution;
                const targetLookback = parseInt(lookback) || HISTORY_CONFIG.lookback;
                const saveCsv = saveCsvAns.trim().toLowerCase() === 'y';

                await fetchHistoryData(
                    epic.trim() || HISTORY_CONFIG.epic,
                    targetResolution,
                    targetLookback,
                    saveCsv
                );
                break;
            case '6':
                // 获取多分辨率历史数据
                const epicMulti = await ask(`请输入 EPIC 代码 [默认：${HISTORY_CONFIG.epic}]: `);
                const lookbackMulti = await ask(`请输入数据点数 [默认：${HISTORY_CONFIG.lookback}]: `);

                await fetchMultiResolutionHistoryData(
                    epicMulti.trim() || HISTORY_CONFIG.epic,
                    parseInt(lookbackMulti) || HISTORY_CONFIG.lookback
                );
                break;
            case '0':
                console.log('再见！');
                readline.close();
                process.exit(0);
            default:
                console.log('无效选择，请输入 0-6');
        }

        // 停顿一下让用户看清输出
        await sleep(1000);
    }
}

// ==========================================
// 7. 主程序入口
// ==========================================

async function main() {
    console.log('正在初始化 IG 外汇行情数据获取工具...\n');

    // 检查 axios 是否安装
    try {
        require.resolve('axios');
    } catch (e) {
        console.error('错误：缺少 axios 依赖，请先运行：npm install axios');
        process.exit(1);
    }

    await handleUserInput();
}

// 启动程序
main().catch(err => {
    console.error('程序异常:', err);
    process.exit(1);
});
