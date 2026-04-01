/**
 * 文件名: ig_market_data_test.js
 * 作用简述: 该脚本用于测试 IG.com REST API 的连通性。它通过用户配置的具体凭据（API Key、用户名、密码）进行身份验证，获取安全令牌 (CST 和 X-SECURITY-TOKEN)，并使用这些令牌请求特定交易品种 (Epic) 的当前行情快照数据。
 */

const axios = require('axios');

// ==========================================
// 1. 配置区域 (已更新为用户提供的凭据)
// ==========================================
const IG_CONFIG = {
    API_KEY: 'c9793f981071be87384ce1b4cd2d0c07614fc10e',       
    IDENTIFIER: 'Dashwood',      
    PASSWORD: 'Dashwood@123',         
    // 使用 Demo 环境网关
    BASE_URL: 'https://demo-api.ig.com/gateway/deal',
    // 测试用的交易品种代码 (Epic): 欧元/美元 迷你合约
    TEST_EPIC: 'CS.D.EURUSD.MINI.IP' 
};

// 用于在请求之间存储认证 Token
let cstToken = '';
let securityToken = '';

// ==========================================
// 2. 核心功能函数
// ==========================================

/**
 * 步骤一：登录并获取安全令牌
 */
async function loginToIG() {
    console.log('开始连接 IG API 并进行身份验证...');
    try {
        const response = await axios.post(`${IG_CONFIG.BASE_URL}/session`, 
            {
                identifier: IG_CONFIG.IDENTIFIER,
                password: IG_CONFIG.PASSWORD
            }, 
            {
                headers: {
                    'X-IG-API-KEY': IG_CONFIG.API_KEY,
                    'Version': '2', // IG API V2 登录验证
                    'Accept': 'application/json; charset=UTF-8',
                    'Content-Type': 'application/json; charset=UTF-8'
                }
            }
        );

        // 验证：检查 Header 中是否成功返回了我们需要的两个 Token
        cstToken = response.headers['cst'];
        securityToken = response.headers['x-security-token'];

        if (!cstToken || !securityToken) {
            throw new Error('登录成功，但未能在响应头中找到 CST 或 X-SECURITY-TOKEN，请检查 API 版本。');
        }

        console.log('✅ 登录成功！已成功获取鉴权令牌。');
        console.log(`当前账户ID: ${response.data.accountId}`);

    } catch (error) {
        console.error('❌ 登录失败:');
        if (error.response) {
            console.error(`状态码: ${error.response.status}`);
            console.error(`错误信息: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(error.message);
        }
        // 登录失败直接抛出异常，阻止后续请求
        throw error; 
    }
}

/**
 * 步骤二：使用令牌获取特定品种的行情快照
 */
async function fetchMarketData() {
    console.log(`\n准备获取品种 [${IG_CONFIG.TEST_EPIC}] 的行情数据...`);
    try {
        const response = await axios.get(`${IG_CONFIG.BASE_URL}/markets/${IG_CONFIG.TEST_EPIC}`, {
            headers: {
                'X-IG-API-KEY': IG_CONFIG.API_KEY,
                'CST': cstToken,
                'X-SECURITY-TOKEN': securityToken,
                'Version': '1', 
                'Accept': 'application/json; charset=UTF-8'
            }
        });

        const marketData = response.data;
        
        console.log('✅ 行情数据获取成功！');
        console.log('--------------------------------------------------');
        console.log(`品种名称: ${marketData.instrument.name}`);
        console.log(`当前买价 (Bid): ${marketData.snapshot.bid}`);
        console.log(`当前卖价 (Offer): ${marketData.snapshot.offer}`);
        console.log(`最高价 (High): ${marketData.snapshot.high}`);
        console.log(`最低价 (Low): ${marketData.snapshot.low}`);
        console.log(`市场状态: ${marketData.snapshot.marketStatus}`);
        console.log('--------------------------------------------------');

    } catch (error) {
        console.error('❌ 获取行情数据失败:');
        if (error.response) {
            console.error(`状态码: ${error.response.status}`);
            console.error(`错误信息: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(error.message);
        }
    }
}

// ==========================================
// 3. 主执行流程
// ==========================================
async function runTest() {
    try {
        await loginToIG();
        await fetchMarketData();
    } catch (error) {
        console.error('\n测试流程意外终止，请根据上述报错信息进行排查。');
    }
}

// 启动脚本
runTest();
