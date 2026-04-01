import databento as db

# 用你的 API KEY（记得换新的）
client = db.Historical(key="db-qDU9X775b9vUwsBuytq7d7eMvKqis")

data = client.timeseries.get_range(
    dataset="XNAS.ITCH",
    schema="ohlcv-1m",   # 1分钟K线（含成交量🔥）
    symbols=["AAPL"],
    start="2025-01-02",
    end="2025-01-03",
)

# 转 pandas 看
df = data.to_df()
print(df.head())
