import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass, replace
from typing import Any

from app.config import EXCHANGES, SYMBOLS, settings
from app.models import (
    LiquidationEvent,
    MarketMetrics,
    NormalizedOrderBook,
    SourceStatus,
    to_dict,
)

MarketEvent = dict[str, Any]


@dataclass(eq=False, slots=True)
class Subscriber:
    queue: asyncio.Queue[MarketEvent | None]
    symbols: frozenset[str] | None = None
    disconnected: bool = False

    async def get(self) -> MarketEvent | None:
        return await self.queue.get()

    def disconnect(self) -> None:
        self.disconnected = True
        while not self.queue.empty():
            self.queue.get_nowait()
        self.queue.put_nowait(None)


class StateManager:
    def __init__(
        self,
        *,
        orderbook_publish_interval_seconds: float = settings.websocket_orderbook_interval_seconds,
        subscriber_queue_size: int = settings.websocket_subscriber_queue_size,
    ) -> None:
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
        self._subscribers: set[Subscriber] = set()
        self._subscriber_queue_size = subscriber_queue_size
        self._orderbook_publish_interval = orderbook_publish_interval_seconds
        self._pending_order_books: dict[tuple[str, str], MarketEvent] = {}
        self._orderbook_flush_tasks: dict[tuple[str, str], asyncio.Task[None]] = {}
        self._last_orderbook_publish: dict[tuple[str, str], float] = {}

    async def set_order_book(self, book: NormalizedOrderBook) -> None:
        async with self._lock:
            self._order_books[(book.exchange, book.symbol)] = book
        await self._publish_order_book(book)

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

    def subscribe(
        self, *, symbols: set[str] | None = None, maxsize: int | None = None
    ) -> Subscriber:
        subscriber = Subscriber(
            queue=asyncio.Queue(
                maxsize=self._subscriber_queue_size if maxsize is None else maxsize
            ),
            symbols=frozenset(symbols) if symbols is not None else None,
        )
        self._subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: Subscriber) -> None:
        self._subscribers.discard(subscriber)

    async def publish(self, event_type: str, data: dict[str, Any]) -> None:
        event = {"type": event_type, "data": data}
        event_symbol = data.get("symbol")
        stale: list[Subscriber] = []
        for subscriber in tuple(self._subscribers):
            if (
                event_symbol is not None
                and subscriber.symbols is not None
                and event_symbol not in subscriber.symbols
            ):
                continue
            try:
                subscriber.queue.put_nowait(event)
            except asyncio.QueueFull:
                subscriber.disconnect()
                stale.append(subscriber)
        for subscriber in stale:
            self._subscribers.discard(subscriber)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def close(self) -> None:
        tasks = list(self._orderbook_flush_tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._orderbook_flush_tasks.clear()
        self._pending_order_books.clear()
        for subscriber in tuple(self._subscribers):
            subscriber.disconnect()
        self._subscribers.clear()

    async def _publish_order_book(self, book: NormalizedOrderBook) -> None:
        if not self._subscribers:
            return
        key = (book.exchange, book.symbol)
        event: MarketEvent = {"type": "orderbook.update", "data": to_dict(book)}
        now = asyncio.get_running_loop().time()
        elapsed = now - self._last_orderbook_publish.get(key, float("-inf"))
        if key not in self._orderbook_flush_tasks and elapsed >= self._orderbook_publish_interval:
            self._last_orderbook_publish[key] = now
            await self.publish(event["type"], event["data"])
            return

        self._pending_order_books[key] = event
        if key not in self._orderbook_flush_tasks:
            delay = max(0.0, self._orderbook_publish_interval - elapsed)
            self._orderbook_flush_tasks[key] = asyncio.create_task(
                self._flush_order_books(key, delay), name=f"orderbook-publish-{key[0]}-{key[1]}"
            )

    async def _flush_order_books(self, key: tuple[str, str], delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            while key in self._pending_order_books:
                event = self._pending_order_books.pop(key)
                self._last_orderbook_publish[key] = asyncio.get_running_loop().time()
                await self.publish(event["type"], event["data"])
                if key in self._pending_order_books:
                    await asyncio.sleep(self._orderbook_publish_interval)
        finally:
            self._orderbook_flush_tasks.pop(key, None)


def _now_ms() -> int:
    return int(time.time() * 1000)
