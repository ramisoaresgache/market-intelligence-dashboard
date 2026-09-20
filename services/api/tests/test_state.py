import asyncio
import time

import pytest

from app.models import LiquidationEvent, MarketMetrics, NormalizedOrderBook, OrderLevel
from app.state import StateManager


def _book(sequence: int) -> NormalizedOrderBook:
    level = OrderLevel(price=100.0, qty=float(sequence), notional=100.0 * sequence)
    return NormalizedOrderBook("binance", "BTCUSDT", sequence, [level], [level], sequence)


@pytest.mark.asyncio
async def test_state_returns_normalized_snapshot_and_depth() -> None:
    state = StateManager()
    level = OrderLevel(price=100.0, qty=2.0, notional=200.0)
    await state.set_order_book(
        NormalizedOrderBook("binance", "BTCUSDT", 1, [level, level], [level], 42)
    )
    await state.update_metrics(MarketMetrics("binance", "BTCUSDT", 2, open_interest=123.0))

    books = await state.get_order_books("BTCUSDT", depth=1)
    snapshot = await state.snapshot("BTCUSDT")

    assert len(books[0]["bids"]) == 1
    assert snapshot["metrics"][0]["open_interest"] == 123.0


@pytest.mark.asyncio
async def test_state_filters_liquidations_by_window() -> None:
    state = StateManager()
    now = int(time.time() * 1000)
    for ts in (now - 10_000, now - 5_000):
        await state.add_liquidation(
            LiquidationEvent("bybit", "ETHUSDT", ts, "long", 10.0, 2.0, 20.0, "all")
        )

    events = await state.get_liquidations("ETHUSDT", now - 7_000)
    assert len(events) == 1


@pytest.mark.asyncio
async def test_metrics_partial_updates_preserve_ticker_fields() -> None:
    state = StateManager()
    await state.update_metrics(
        MarketMetrics("bybit", "SOLUSDT", 1, mark_price=150.0, funding_rate=0.0001)
    )
    await state.update_metrics(MarketMetrics("bybit", "SOLUSDT", 2, open_interest=1000.0))

    snapshot = await state.snapshot("SOLUSDT")
    metric = snapshot["metrics"][0]
    assert metric["mark_price"] == 150.0
    assert metric["open_interest"] == 1000.0


@pytest.mark.asyncio
async def test_orderbook_updates_are_coalesced_without_slowing_internal_state() -> None:
    state = StateManager(orderbook_publish_interval_seconds=0.05)
    subscriber = state.subscribe(maxsize=10)

    await state.set_order_book(_book(1))
    first = await asyncio.wait_for(subscriber.get(), timeout=0.1)
    await state.set_order_book(_book(2))
    await state.set_order_book(_book(3))

    snapshot = await state.snapshot("BTCUSDT")
    assert snapshot["order_books"][0]["sequence"] == 3
    second = await asyncio.wait_for(subscriber.get(), timeout=0.2)
    assert first is not None and first["data"]["sequence"] == 1
    assert second is not None and second["data"]["sequence"] == 3
    assert subscriber.queue.empty()
    await state.close()


@pytest.mark.asyncio
async def test_full_subscriber_queue_disconnects_with_explicit_sentinel() -> None:
    state = StateManager()
    subscriber = state.subscribe(maxsize=1)

    await state.publish("metrics.update", {"symbol": "BTCUSDT", "value": 1})
    await state.publish("metrics.update", {"symbol": "BTCUSDT", "value": 2})

    assert subscriber.disconnected is True
    assert state.subscriber_count == 0
    assert await subscriber.get() is None


@pytest.mark.asyncio
async def test_metrics_publish_a_single_event_type() -> None:
    state = StateManager()
    subscriber = state.subscribe(maxsize=2)

    await state.update_metrics(MarketMetrics("bybit", "BTCUSDT", 1, mark_price=100.0))

    event = await subscriber.get()
    assert event is not None and event["type"] == "metrics.update"
    assert subscriber.queue.empty()
