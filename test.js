const axios = require("axios");

// =====================
// 写死你的信息（测试用）
// =====================
const API_KEY = "1269ee04941d9ed8b456f57d50681697b8cbd793";
const USERNAME = "Dashwoodx1n";
const PASSWORD = "Dashwood@123";

// 实盘 / demo 切换
const BASE_URL = "https://api.ig.com/gateway/deal";
// const BASE_URL = "https://demo-api.ig.com/gateway/deal";

async function main() {
  try {
    console.log("🔐 登录 IG...");

    const loginRes = await axios.post(
      `${BASE_URL}/session`,
      {
        identifier: USERNAME,
        password: PASSWORD,
      },
      {
        headers: {
          "X-IG-API-KEY": API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json; charset=UTF-8",
        },
        validateStatus: () => true,
      }
    );

    if (loginRes.status !== 200) {
      console.error("❌ 登录失败:", loginRes.status, loginRes.data);
      return;
    }

    const CST = loginRes.headers["cst"];
    const SECURITY_TOKEN = loginRes.headers["x-security-token"];

    console.log("✅ 登录成功");

    // =====================
    // 🔍 搜索市场（解决404关键）
    // =====================
    console.log("\n🔍 搜索 AAPL...");

    const searchRes = await axios.get(
      `${BASE_URL}/markets?searchTerm=AAPL`,
      {
        headers: {
          "X-IG-API-KEY": API_KEY,
          CST: CST,
          "X-SECURITY-TOKEN": SECURITY_TOKEN,
        },
      }
    );

    const markets = searchRes.data.markets;

    if (!markets || markets.length === 0) {
      console.log("❌ 没找到 AAPL");
      return;
    }

    // 打印所有候选
    console.log("\n📋 可用市场：");
    markets.forEach((m, i) => {
      console.log(`${i + 1}. ${m.instrumentName} | ${m.epic}`);
    });

    // 默认取第一个
    const epic = markets[0].epic;

    console.log("\n✅ 使用 EPIC:", epic);

    // =====================
    // 📊 获取行情
    // =====================
    console.log("\n📊 获取行情...");

    const marketRes = await axios.get(
      `${BASE_URL}/markets/${epic}`,
      {
        headers: {
          "X-IG-API-KEY": API_KEY,
          CST: CST,
          "X-SECURITY-TOKEN": SECURITY_TOKEN,
        },
      }
    );

    const data = marketRes.data;

    console.log("\n📈 市场:", data.instrument.name);
    console.log("💰 Bid:", data.snapshot.bid);
    console.log("💰 Ask:", data.snapshot.offer);
    console.log("📊 High:", data.snapshot.high);
    console.log("📊 Low:", data.snapshot.low);
    console.log("⏰ 更新时间:", data.snapshot.updateTime);

  } catch (err) {
    if (err.response) {
      console.error("❌ API错误:", err.response.status, err.response.data);
    } else {
      console.error("❌ 出错:", err.message);
    }
  }
}

main();
