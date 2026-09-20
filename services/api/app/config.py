from dataclasses import dataclass

SYMBOLS: tuple[str, ...] = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
EXCHANGES: tuple[str, ...] = ("binance", "bybit")


@dataclass(frozen=True, slots=True)
class Settings:
    binance_ws_base: str = "wss://fstream.binance.com"
    binance_rest_base: str = "https://fapi.binance.com"
    bybit_ws_url: str = "wss://stream.bybit.com/v5/public/linear"
    bybit_rest_base: str = "https://api.bybit.com"
    open_interest_poll_seconds: float = 30.0
    bybit_open_interest_poll_seconds: float = 60.0
    max_orderbook_depth: int = 200
    liquidation_retention_seconds: int = 24 * 60 * 60


settings = Settings()
