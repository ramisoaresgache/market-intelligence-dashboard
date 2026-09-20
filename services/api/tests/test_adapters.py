import pytest

from app.adapters.binance import BinanceAdapter, _apply_levels
from app.adapters.bybit import BybitAdapter
from app.state import StateManager


def test_binance_depth_delta_updates_and_removes_levels() -> None:
    levels = {100.0: 2.0, 99.0: 1.0}
    _apply_levels(levels, [["100", "0"], ["101", "3.5"]])
    assert levels == {99.0: 1.0, 101.0: 3.5}


def test_binance_rejects_depth_sequence_gap() -> None:
    adapter = BinanceAdapter(StateManager())
    with pytest.raises(RuntimeError, match="sequence gap"):
        adapter._apply_depth_event(
            "BTCUSDT",
            {"U": 12, "u": 12, "pu": 10, "b": [], "a": []},
            {},
            {},
            11,
            first_event=False,
        )


@pytest.mark.asyncio
async def test_bybit_snapshot_and_delta_are_normalized() -> None:
    state = StateManager()
    adapter = BybitAdapter(state)
    await adapter._handle_orderbook(
        {
            "type": "snapshot",
            "ts": 1,
            "data": {
                "s": "BTCUSDT",
                "u": 100,
                "seq": 200,
                "b": [["100", "2"]],
                "a": [["101", "3"]],
            },
        }
    )
    await adapter._handle_orderbook(
        {
            "type": "delta",
            "ts": 2,
            "data": {
                "s": "BTCUSDT",
                "u": 101,
                "seq": 201,
                "b": [["100", "0"], ["99", "4"]],
                "a": [],
            },
        }
    )

    books = await state.get_order_books("BTCUSDT")
    assert books[0]["bids"] == [{"price": 99.0, "qty": 4.0, "notional": 396.0}]
