import os
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
    cors_allowed_origins: tuple[str, ...] = ("http://localhost:3000",)
    websocket_orderbook_interval_seconds: float = 0.2
    websocket_subscriber_queue_size: int = 100
    websocket_send_timeout_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "Settings":
        raw_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
        origins = tuple(origin.strip() for origin in raw_origins.split(",") if origin.strip())
        return cls(cors_allowed_origins=origins or cls().cors_allowed_origins)


settings = Settings.from_env()
