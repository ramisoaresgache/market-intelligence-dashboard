import asyncio
import json
import time
from typing import Any

import httpx
import websockets

from app.adapters.base import ExchangeAdapter, SequenceGapError
from app.config import SYMBOLS, settings
from app.models import LiquidationEvent, MarketMetrics, NormalizedOrderBook, OrderLevel


class BinanceAdapter(ExchangeAdapter):
    exchange = "binance"

    async def run(self) -> None:
        async with httpx.AsyncClient(base_url=settings.binance_rest_base, timeout=10) as client:
            async with asyncio.TaskGroup() as group:
                for symbol in SYMBOLS:
                    group.create_task(self._stream_depth(symbol, client))
                group.create_task(self._stream_liquidations())
                group.create_task(self._poll_open_interest(client))

    async def _stream_depth(self, symbol: str, client: httpx.AsyncClient) -> None:
        stream = f"{symbol.lower()}@depth@100ms"
        url = f"{settings.binance_ws_base}/public/ws/{stream}"
        async with websockets.connect(
            url, open_timeout=10, ping_interval=180, ping_timeout=30, max_queue=2048
        ) as websocket:
            await self.mark_connected()
            first = _decode(await websocket.recv())
            snapshot_response = await client.get(
                "/fapi/v1/depth", params={"symbol": symbol, "limit": 1000}
            )
            snapshot_response.raise_for_status()
            snapshot = snapshot_response.json()
            bids = _levels_to_map(snapshot["bids"])
            asks = _levels_to_map(snapshot["asks"])
            last_update_id = int(snapshot["lastUpdateId"])
            synchronized = False
            event = first

            while True:
                if not synchronized:
                    if int(event["u"]) <= last_update_id:
                        event = _decode(await websocket.recv())
                        continue
                    if not int(event["U"]) <= last_update_id + 1 <= int(event["u"]):
                        raise SequenceGapError(f"{symbol} snapshot did not overlap depth stream")
                    last_update_id = self._apply_depth_event(
                        symbol, event, bids, asks, last_update_id, first_event=True
                    )
                    synchronized = True
                    await self._store_book(symbol, event, bids, asks, last_update_id)
                else:
                    last_update_id = self._apply_depth_event(
                        symbol, event, bids, asks, last_update_id, first_event=False
                    )
                    await self._store_book(symbol, event, bids, asks, last_update_id)
                event = _decode(await websocket.recv())

    def _apply_depth_event(
        self,
        symbol: str,
        event: dict[str, Any],
        bids: dict[float, float],
        asks: dict[float, float],
        last_update_id: int,
        *,
        first_event: bool,
    ) -> int:
        if not first_event and int(event.get("pu", last_update_id)) != last_update_id:
            raise SequenceGapError(f"{symbol} depth sequence gap")
        _apply_levels(bids, event.get("b", []))
        _apply_levels(asks, event.get("a", []))
        return int(event["u"])

    async def _store_book(
        self,
        symbol: str,
        event: dict[str, Any],
        bids: dict[float, float],
        asks: dict[float, float],
        sequence: int,
    ) -> None:
        depth = settings.max_orderbook_depth
        await self.state.set_order_book(
            NormalizedOrderBook(
                exchange=self.exchange,
                symbol=symbol,
                ts=int(event.get("E", _now_ms())),
                bids=_normal_levels(bids, reverse=True, depth=depth),
                asks=_normal_levels(asks, reverse=False, depth=depth),
                sequence=sequence,
            )
        )

    async def _stream_liquidations(self) -> None:
        url = f"{settings.binance_ws_base}/market/ws/!forceOrder@arr"
        async with websockets.connect(
            url, open_timeout=10, ping_interval=180, ping_timeout=30
        ) as websocket:
            async for raw in websocket:
                payload = _decode(raw)
                entries = payload if isinstance(payload, list) else [payload]
                for entry in entries:
                    event = entry.get("data", entry)
                    order = event.get("o")
                    if not isinstance(order, dict) or order.get("s") not in SYMBOLS:
                        continue
                    price = float(order.get("ap") or order["p"])
                    qty = float(order.get("z") or order["q"])
                    await self.state.add_liquidation(
                        LiquidationEvent(
                            exchange=self.exchange,
                            symbol=str(order["s"]),
                            ts=int(order.get("T", event.get("E", _now_ms()))),
                            side="long" if order["S"] == "SELL" else "short",
                            price=price,
                            qty=qty,
                            notional=price * qty,
                            source_quality="snapshot",
                        )
                    )

    async def _poll_open_interest(self, client: httpx.AsyncClient) -> None:
        while True:
            for symbol in SYMBOLS:
                response = await client.get("/fapi/v1/openInterest", params={"symbol": symbol})
                response.raise_for_status()
                payload = response.json()
                await self.state.update_metrics(
                    MarketMetrics(
                        exchange=self.exchange,
                        symbol=symbol,
                        ts=int(payload.get("time", _now_ms())),
                        open_interest=float(payload["openInterest"]),
                    )
                )
            await asyncio.sleep(settings.open_interest_poll_seconds)


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


def _now_ms() -> int:
    return int(time.time() * 1000)
