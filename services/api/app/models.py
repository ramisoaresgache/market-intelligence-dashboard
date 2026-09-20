from dataclasses import asdict, dataclass
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class OrderLevel:
    price: float
    qty: float
    notional: float


@dataclass(frozen=True, slots=True)
class NormalizedOrderBook:
    exchange: str
    symbol: str
    ts: int
    bids: list[OrderLevel]
    asks: list[OrderLevel]
    sequence: str | int | None = None
    market_type: Literal["perpetual"] = "perpetual"


@dataclass(frozen=True, slots=True)
class LiquidationEvent:
    exchange: str
    symbol: str
    ts: int
    side: Literal["long", "short"]
    price: float
    qty: float
    notional: float
    source_quality: Literal["all", "snapshot"]


@dataclass(frozen=True, slots=True)
class MarketMetrics:
    exchange: str
    symbol: str
    ts: int
    mark_price: float | None = None
    last_price: float | None = None
    open_interest: float | None = None
    open_interest_value: float | None = None
    funding_rate: float | None = None
    next_funding_time: int | None = None


@dataclass(frozen=True, slots=True)
class SourceStatus:
    exchange: str
    connected: bool
    ts: int
    detail: str | None = None


def to_dict(value: Any) -> dict[str, Any]:
    return asdict(value)
