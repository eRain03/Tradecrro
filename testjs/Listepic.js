/**
 * 文件名: search_forex.js
 * 作用简述: 由于 IG 官方已废弃目录遍历接口，本脚本改用批量关键词搜索 (/markets?searchTerm=) 的方式，查询主要法币关键字，从而聚合出可用的外汇交易对列表。
 */

const axios = require('axios');

// ==========================================
// 1. 配置区域
// ==========================================
const IG_CONFIG = {
    API_KEY: 'c9793f981071be87384ce1b4cd2d0c07614fc10e',       
    IDENTIFIER: 'Dashwood',      
    PASSWORD: 'Dashwood@123',         
    BASE_URL: 'https://demo-api.ig.com/gateway/deal'
};

// 我们想搜索的核心货币关键字，你可以按需继续往里面添加（如 'AUD', 'CAD', 'CHF'）
const SEARCH_KEYWORDS = ['USD', 'EUR', 'GBP', 'JPY']; 

let cstToken = '';
let securityToken = '';
let allFoundMarkets = []; // 存放去重后的市场数据

// ==========================================
// 2. 辅助与核心函数
// ==========================================

// 延时函数，严格控制请求频率
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function loginToIG() {
    console.log('正在验证身份...');
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

        if (!cstToken || !securityToken) throw new Error('未能获取令牌');
        console.log(`✅ 登录成功！当前账户ID: ${response.data.currentAccountId}`);
    } catch (error) {
        console.error('❌ 登录失败');
        throw error; 
    }
}

/**
 * 步骤二：使用关键词搜索市场品种
 */
async function searchMarketsByKeyword(keyword) {
    console.log(`正在搜索包含 "${keyword}" 的交易品种...`);
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

        const markets = response.data.markets;
        let count = 0;

        if (markets && markets.length > 0) {
            markets.forEach(market => {
                // 仅保存状态为可交易 (TRADEABLE) 的品种
                if (market.marketStatus === 'TRADEABLE') {
                    // 防止不同关键字搜索出重复的品种 (比如搜索 EUR 和 USD 都会搜到 EUR/USD)
                    const isDuplicate = allFoundMarkets.some(m => m.epic === market.epic);
                    if (!isDuplicate) {
                        allFoundMarkets.push({
                            name: market.instrumentName,
                            epic: market.epic,
                            type: market.instrumentType
                        });
                        count++;
                    }
                }
            });
        }
        console.log(`  └─ 新增了 ${count} 个活跃的交易品种。`);

    } catch (error) {
        console.error(`❌ 搜索 ${keyword} 时发生错误:`, error.message);
    }
}

// ==========================================
// 3. 主执行流程
// ==========================================
async function runSearchTask() {
    try {
        await loginToIG();
        
        console.log('\n🔍 开始通过关键词矩阵检索外汇市场...');
        
        for (const keyword of SEARCH_KEYWORDS) {
            await searchMarketsByKeyword(keyword);
            // 每次请求后强制停顿 1 秒，严格防止触发 API 速率限制封禁
            await sleep(1000); 
        }
        
        console.log('\n==================================================');
        console.log(`🎉 检索完成！共计获取到 ${allFoundMarkets.length} 个去重后的活跃交易对。`);
        console.log('==================================================');
        
        // 打印前 20 个作为展示
        console.log('以下是部分交易对的预览：');
        const previewList = allFoundMarkets.slice(0, 80);
        console.table(previewList);

    } catch (error) {
        console.error('\n任务意外终止。');
    }
}

runSearchTask();
