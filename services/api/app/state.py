import asyncio
import time
from collections import defaultdict, deque
from dataclasses import replace
from typing import Any

from app.config import EXCHANGES, SYMBOLS, settings
from app.models import (
    LiquidationEvent,
    MarketMetrics,
    NormalizedOrderBook,
    SourceStatus,
    to_dict,
)


class StateManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._order_books: dict[tuple[str, str], NormalizedOrderBook] = {}
        self._liquidations: dict[str, deque[LiquidationEvent]] = defaultdict(deque)
        self._metrics: dict[tuple[str, str], MarketMetrics] = {}
        self._sources: dict[str, SourceStatus] = {
            exchange: SourceStatus(
                exchange=exchange, connected=False, ts=_now_ms(), detail="starting"
            )
            for exchange in EXCHANGES
        }
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    async def set_order_book(self, book: NormalizedOrderBook) -> None:
        async with self._lock:
            self._order_books[(book.exchange, book.symbol)] = book
        await self.publish("orderbook.update", to_dict(book))

    async def add_liquidation(self, event: LiquidationEvent) -> None:
        cutoff = _now_ms() - settings.liquidation_retention_seconds * 1000
        async with self._lock:
            events = self._liquidations[event.symbol]
            events.append(event)
            while events and events[0].ts < cutoff:
                events.popleft()
        await self.publish("liquidation.event", to_dict(event))

    async def update_metrics(self, update: MarketMetrics) -> None:
        key = (update.exchange, update.symbol)
        async with self._lock:
            current = self._metrics.get(key)
            if current is not None:
                values = to_dict(update)
                merged = {
                    field: value if value is not None else getattr(current, field)
                    for field, value in values.items()
                }
                fields = {"exchange", "symbol", "ts"}
                update = replace(update, **{k: v for k, v in merged.items() if k not in fields})
            self._metrics[key] = update
        await self.publish("metrics.update", to_dict(update))
        await self.publish("ticker.update", to_dict(update))

    async def set_source_status(self, status: SourceStatus) -> None:
        async with self._lock:
            self._sources[status.exchange] = status
        await self.publish("source.status", to_dict(status))

    async def get_order_books(
        self, symbol: str, exchange: str = "all", depth: int = 50
    ) -> list[dict[str, Any]]:
        async with self._lock:
            books = [
                book
                for (book_exchange, book_symbol), book in self._order_books.items()
                if book_symbol == symbol and (exchange == "all" or book_exchange == exchange)
            ]
        return [
            {
                **to_dict(book),
                "bids": [to_dict(level) for level in book.bids[:depth]],
                "asks": [to_dict(level) for level in book.asks[:depth]],
            }
            for book in sorted(books, key=lambda item: item.exchange)
        ]

    async def get_liquidations(self, symbol: str, since_ms: int) -> list[dict[str, Any]]:
        async with self._lock:
            events = [event for event in self._liquidations[symbol] if event.ts >= since_ms]
        return [to_dict(event) for event in events]

    async def snapshot(self, symbol: str) -> dict[str, Any]:
        async with self._lock:
            books = [
                to_dict(book)
                for (_, book_symbol), book in self._order_books.items()
                if book_symbol == symbol
            ]
            metrics = [
                to_dict(metric)
                for (_, metric_symbol), metric in self._metrics.items()
                if metric_symbol == symbol
            ]
            liquidations = [to_dict(event) for event in list(self._liquidations[symbol])[-100:]]
            sources = [to_dict(source) for source in self._sources.values()]
        return {
            "symbol": symbol,
            "ts": _now_ms(),
            "order_books": books,
            "metrics": metrics,
            "liquidations": liquidations,
            "sources": sources,
        }

    async def health(self) -> dict[str, Any]:
        async with self._lock:
            sources = {name: to_dict(status) for name, status in self._sources.items()}
        connected = sum(bool(source["connected"]) for source in sources.values())
        return {
            "status": "ok" if connected == len(EXCHANGES) else "degraded",
            "ts": _now_ms(),
            "symbols": list(SYMBOLS),
            "sources": sources,
        }

    def subscribe(self, maxsize: int = 500) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=maxsize)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    async def publish(self, event_type: str, data: dict[str, Any]) -> None:
        event = {"type": event_type, "data": data}
        stale: list[asyncio.Queue[dict[str, Any]]] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                stale.append(queue)
        for queue in stale:
            self._subscribers.discard(queue)


def _now_ms() -> int:
    return int(time.time() * 1000)
