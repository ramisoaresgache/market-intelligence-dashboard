import asyncio
import logging
import random
import time
from abc import ABC, abstractmethod

from app.models import SourceStatus
from app.state import StateManager

logger = logging.getLogger(__name__)


class SequenceGapError(RuntimeError):
    pass


class ExchangeAdapter(ABC):
    exchange: str

    def __init__(self, state: StateManager) -> None:
        self.state = state
        self._stopping = asyncio.Event()
        self._reconnect_attempt = 0

    async def run_forever(self) -> None:
        while not self._stopping.is_set():
            try:
                await self.state.set_source_status(
                    SourceStatus(self.exchange, False, _now_ms(), "connecting")
                )
                await self.run()
                raise ConnectionError("exchange stream ended")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._reconnect_attempt += 1
                delay = min(30.0, 0.5 * (2 ** min(self._reconnect_attempt, 6))) + random.uniform(
                    0, 0.5
                )
                detail = _error_detail(exc)
                logger.warning("%s adapter reconnecting in %.1fs: %s", self.exchange, delay, detail)
                await self.state.set_source_status(
                    SourceStatus(self.exchange, False, _now_ms(), f"reconnecting: {detail}")
                )
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=delay)
                except TimeoutError:
                    pass

    def stop(self) -> None:
        self._stopping.set()

    async def mark_connected(self) -> None:
        self._reconnect_attempt = 0
        await self.state.set_source_status(
            SourceStatus(self.exchange, True, _now_ms(), "connected")
        )

    @abstractmethod
    async def run(self) -> None:
        raise NotImplementedError


def _now_ms() -> int:
    return int(time.time() * 1000)


def _error_detail(error: BaseException) -> str:
    if isinstance(error, BaseExceptionGroup):
        return "; ".join(_error_detail(item) for item in error.exceptions)
    return f"{type(error).__name__}: {error}"
