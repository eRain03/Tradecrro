import IGClient from './IGClient';

/**
 * 外汇对数据结构
 */
export interface ForexPair {
  epic: string;           // IG 市场的唯一标识符，如 CS.D.EURUSD.CFD.IP
  pairName: string;       // 标准化名称，如 EUR/USD
  instrumentName: string; // IG 返回的完整名称
  instrumentType: string; // CURRENCIES
  marketStatus: string;   // TRADEABLE, CLOSED 等
}

/**
 * 外汇对检索服务
 *
 * 使用关键词矩阵搜索 IG 市场，获取所有可用的外汇交易对
 * 参考：testjs/testall.js
 */
export class ForexPairFetcher {
  private igClient: IGClient;

  // 核心货币关键字矩阵
  private searchKeywords = [
    'USD', 'EUR', 'GBP', 'JPY',
    'AUD', 'CAD', 'CHF', 'NZD'
  ];

  constructor(igClient: IGClient) {
    this.igClient = igClient;
  }

  /**
   * 检索所有可用的外汇交易对
   *
   * @returns 去重后的外汇对列表
   */
  async searchAllForexPairs(): Promise<ForexPair[]> {
    console.log('🔍 开始从 IG API 检索外汇交易对...');

    // 确保已认证
    if (!this.igClient.isConnected) {
      await this.igClient.authenticate();
    }

    const allPairs: ForexPair[] = [];
    const epicSet = new Set<string>();

    // 逐个关键字搜索
    for (const keyword of this.searchKeywords) {
      console.log(`  正在搜索包含 "${keyword}" 的交易品种...`);

      try {
        const markets = await this.searchMarkets(keyword);

        let addedCount = 0;
        for (const market of markets) {
          // 只保留外汇类型且可交易的品种
          if (market.instrumentType === 'CURRENCIES' &&
              market.marketStatus === 'TRADEABLE') {

            // 去重：检查 epic 是否已存在
            if (!epicSet.has(market.epic)) {
              epicSet.add(market.epic);

              const forexPair = this.normalizePair(market);
              if (forexPair) {
                allPairs.push(forexPair);
                addedCount++;
              }
            }
          }
        }

        console.log(`    └─ 新增了 ${addedCount} 个交易对`);

      } catch (error) {
        console.error(`    ❌ 搜索 ${keyword} 时失败:`, error);
      }

      // 每次请求后延时 1 秒，防止触发 API 速率限制
      await this.sleep(1000);
    }

    console.log(`\n✅ 检索完成！共计获取到 ${allPairs.length} 个去重后的活跃外汇交易对`);
    return allPairs;
  }

  /**
   * 搜索市场
   */
  private async searchMarkets(keyword: string): Promise<any[]> {
    return await this.igClient.searchMarkets(keyword);
  }

  /**
   * 标准化外汇对数据
   *
   * 将 IG 返回的市场数据转换为标准的 ForexPair 格式
   */
  private normalizePair(market: any): ForexPair | null {
    const instrumentName = market.instrumentName || '';

    // 跳过非标准合约（迷你合约、特殊合约等）
    // 优先选择 CFD 合约
    if (!market.epic.includes('.CFD.IP')) {
      // 如果没有 CFD 合约，也可以接受其他标准合约
      // 这里根据需求调整
    }

    // 从 instrumentName 提取货币对名称
    // 例如："欧元/美元" -> "EUR/USD"
    // 或者："EUR/USD" -> "EUR/USD"
    const pairName = this.extractPairName(instrumentName);

    if (!pairName) {
      return null;
    }

    return {
      epic: market.epic,
      pairName: pairName,
      instrumentName: instrumentName,
      instrumentType: market.instrumentType || 'CURRENCIES',
      marketStatus: market.marketStatus || 'TRADEABLE',
    };
  }

  /**
   * 从 instrumentName 提取标准化的货币对名称
   *
   * 支持中文和英文名称解析
   */
  private extractPairName(instrumentName: string): string | null {
    // 货币代码映射（中文 -> 英文）
    const currencyMap: Record<string, string> = {
      '欧元': 'EUR',
      '美元': 'USD',
      '英镑': 'GBP',
      '日元': 'JPY',
      '澳元': 'AUD',
      '加元': 'CAD',
      '瑞士法郎': 'CHF',
      '新西兰元': 'NZD',
      '人民币': 'CNH',
      '港元': 'HKD',
      '新加坡元': 'SGD',
      '挪威克朗': 'NOK',
      '瑞典克朗': 'SEK',
      '丹麦克郎': 'DKK',
      '波兰兹罗提': 'PLN',
      '捷克克郎': 'CZK',
      '匈牙利福林': 'HUF',
      '土耳其里拉': 'TRY',
      '墨西哥比索': 'MXN',
      '南非兰特': 'ZAR',
      '印度卢比': 'INR',
      '韩圜': 'KRW',
      '菲律宾比索': 'PHP',
      '新台币': 'TWD',
    };

    // 尝试匹配中文名称（如 "欧元/美元"）
    for (const [cnName, enCode] of Object.entries(currencyMap)) {
      if (instrumentName.includes(cnName)) {
        // 查找配对的另一个货币
        for (const [cnName2, enCode2] of Object.entries(currencyMap)) {
          if (cnName !== cnName2 && instrumentName.includes(cnName2)) {
            // 确定顺序：查找哪个货币在前
            const index1 = instrumentName.indexOf(cnName);
            const index2 = instrumentName.indexOf(cnName2);

            if (index1 < index2) {
              return `${enCode}/${enCode2}`;
            } else {
              return `${enCode2}/${enCode}`;
            }
          }
        }
      }
    }

    // 尝试匹配英文名称（如 "EUR/USD"）
    const forexPattern = /([A-Z]{3})\/([A-Z]{3})/;
    const match = instrumentName.match(forexPattern);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }

    // 如果没有匹配到，返回原始名称作为 pairName
    return instrumentName.split(' ')[0];
  }

  /**
   * 延时函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取所有搜索关键字
   */
  getKeywords(): string[] {
    return [...this.searchKeywords];
  }

  /**
   * 添加搜索关键字
   */
  addKeyword(keyword: string): void {
    const upperKeyword = keyword.toUpperCase().trim();
    if (!this.searchKeywords.includes(upperKeyword)) {
      this.searchKeywords.push(upperKeyword);
    }
  }
}

export default ForexPairFetcher;
