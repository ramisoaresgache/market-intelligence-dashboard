import asyncio
import json
import time
from typing import Any

import httpx
import websockets

from app.adapters.base import ExchangeAdapter, SequenceGapError
from app.config import SYMBOLS, settings
from app.models import LiquidationEvent, MarketMetrics, NormalizedOrderBook, OrderLevel


class BybitAdapter(ExchangeAdapter):
    exchange = "bybit"

    def __init__(self, state: Any) -> None:
        super().__init__(state)
        self._bids: dict[str, dict[float, float]] = {}
        self._asks: dict[str, dict[float, float]] = {}
        self._last_update: dict[str, int] = {}

    async def run(self) -> None:
        async with httpx.AsyncClient(base_url=settings.bybit_rest_base, timeout=10) as client:
            async with asyncio.TaskGroup() as group:
                group.create_task(self._stream_public())
                group.create_task(self._poll_open_interest(client))

    async def _stream_public(self) -> None:
        topics = [
            topic
            for symbol in SYMBOLS
            for topic in (
                f"orderbook.50.{symbol}",
                f"allLiquidation.{symbol}",
                f"tickers.{symbol}",
            )
        ]
        async with websockets.connect(
            settings.bybit_ws_url, open_timeout=10, ping_interval=None, max_queue=2048
        ) as websocket:
            await websocket.send(json.dumps({"op": "subscribe", "args": topics}))
            await self.mark_connected()
            async with asyncio.TaskGroup() as group:
                group.create_task(self._heartbeat(websocket))
                group.create_task(self._receive(websocket))

    async def _heartbeat(self, websocket: Any) -> None:
        while True:
            await asyncio.sleep(20)
            await websocket.send(json.dumps({"op": "ping"}))

    async def _receive(self, websocket: Any) -> None:
        async for raw in websocket:
            payload = _decode(raw)
            topic = str(payload.get("topic", ""))
            if topic.startswith("orderbook."):
                await self._handle_orderbook(payload)
            elif topic.startswith("allLiquidation."):
                await self._handle_liquidations(payload)
            elif topic.startswith("tickers."):
                await self._handle_ticker(payload)

    async def _handle_orderbook(self, payload: dict[str, Any]) -> None:
        data = payload.get("data")
        if not isinstance(data, dict):
            return
        symbol = str(data["s"])
        update_id = int(data["u"])
        message_type = payload.get("type")
        if message_type == "snapshot" or update_id == 1:
            self._bids[symbol] = _levels_to_map(data.get("b", []))
            self._asks[symbol] = _levels_to_map(data.get("a", []))
        else:
            if symbol not in self._last_update:
                return
            if update_id <= self._last_update[symbol]:
                return
            if update_id != self._last_update[symbol] + 1:
                raise SequenceGapError(f"{symbol} Bybit depth sequence gap")
            _apply_levels(self._bids[symbol], data.get("b", []))
            _apply_levels(self._asks[symbol], data.get("a", []))
        self._last_update[symbol] = update_id
        depth = settings.max_orderbook_depth
        await self.state.set_order_book(
            NormalizedOrderBook(
                exchange=self.exchange,
                symbol=symbol,
                ts=int(payload.get("ts", _now_ms())),
                bids=_normal_levels(self._bids[symbol], reverse=True, depth=depth),
                asks=_normal_levels(self._asks[symbol], reverse=False, depth=depth),
                sequence=data.get("seq", update_id),
            )
        )

    async def _handle_liquidations(self, payload: dict[str, Any]) -> None:
        data = payload.get("data", [])
        if isinstance(data, dict):
            data = [data]
        for item in data:
            symbol = str(item["s"])
            if symbol not in SYMBOLS:
                continue
            price = float(item["p"])
            qty = float(item["v"])
            await self.state.add_liquidation(
                LiquidationEvent(
                    exchange=self.exchange,
                    symbol=symbol,
                    ts=int(item.get("T", payload.get("ts", _now_ms()))),
                    side="long" if item["S"] == "Buy" else "short",
                    price=price,
                    qty=qty,
                    notional=price * qty,
                    source_quality="all",
                )
            )

    async def _handle_ticker(self, payload: dict[str, Any]) -> None:
        data = payload.get("data")
        if not isinstance(data, dict):
            return
        symbol = str(data["symbol"])
        await self.state.update_metrics(
            MarketMetrics(
                exchange=self.exchange,
                symbol=symbol,
                ts=int(payload.get("ts", _now_ms())),
                mark_price=_optional_float(data.get("markPrice")),
                last_price=_optional_float(data.get("lastPrice")),
                open_interest=_optional_float(data.get("openInterest")),
                open_interest_value=_optional_float(data.get("openInterestValue")),
                funding_rate=_optional_float(data.get("fundingRate")),
                next_funding_time=_optional_int(data.get("nextFundingTime")),
            )
        )

    async def _poll_open_interest(self, client: httpx.AsyncClient) -> None:
        while True:
            for symbol in SYMBOLS:
                response = await client.get(
                    "/v5/market/open-interest",
                    params={
                        "category": "linear",
                        "symbol": symbol,
                        "intervalTime": "5min",
                        "limit": 1,
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if int(payload.get("retCode", -1)) != 0:
                    raise RuntimeError(f"Bybit open interest error: {payload.get('retMsg')}")
                entries = payload.get("result", {}).get("list", [])
                if entries:
                    latest = entries[0]
                    await self.state.update_metrics(
                        MarketMetrics(
                            exchange=self.exchange,
                            symbol=symbol,
                            ts=int(latest.get("timestamp", _now_ms())),
                            open_interest=float(latest["openInterest"]),
                        )
                    )
            await asyncio.sleep(settings.bybit_open_interest_poll_seconds)


def _decode(raw: str | bytes) -> dict[str, Any]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value


def _levels_to_map(levels: list[list[str]]) -> dict[float, float]:
    return {float(price): float(qty) for price, qty, *_ in levels}


def _apply_levels(target: dict[float, float], levels: list[list[str]]) -> None:
    for price_text, qty_text, *_ in levels:
        price = float(price_text)
        qty = float(qty_text)
        if qty == 0:
            target.pop(price, None)
        else:
            target[price] = qty


def _normal_levels(levels: dict[float, float], *, reverse: bool, depth: int) -> list[OrderLevel]:
    prices = sorted(levels, reverse=reverse)[:depth]
    return [
        OrderLevel(price=price, qty=levels[price], notional=price * levels[price])
        for price in prices
    ]


def _optional_float(value: Any) -> float | None:
    return float(value) if value not in (None, "") else None


def _optional_int(value: Any) -> int | None:
    return int(value) if value not in (None, "") else None


def _now_ms() -> int:
    return int(time.time() * 1000)
