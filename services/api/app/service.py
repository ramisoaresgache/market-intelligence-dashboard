import asyncio

from app.adapters.base import ExchangeAdapter
from app.adapters.binance import BinanceAdapter
from app.adapters.bybit import BybitAdapter
from app.state import StateManager


class MarketService:
    def __init__(self, state: StateManager) -> None:
        self.adapters: list[ExchangeAdapter] = [BinanceAdapter(state), BybitAdapter(state)]
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(adapter.run_forever(), name=f"{adapter.exchange}-adapter")
            for adapter in self.adapters
        ]

    async def stop(self) -> None:
        for adapter in self.adapters:
            adapter.stop()
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
