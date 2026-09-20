from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.config import Settings
from app.service import MarketService
from app.state import StateManager


def create_app(*, start_workers: bool = True, app_settings: Settings | None = None) -> FastAPI:
    resolved_settings = app_settings or Settings.from_env()
    state = StateManager(
        orderbook_publish_interval_seconds=resolved_settings.websocket_orderbook_interval_seconds,
        subscriber_queue_size=resolved_settings.websocket_subscriber_queue_size,
    )
    service = MarketService(state)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if start_workers:
            await service.start()
        try:
            yield
        finally:
            if start_workers:
                await service.stop()
            await state.close()

    application = FastAPI(
        title="Market Intelligence API",
        version="0.1.0",
        description="Read-only normalized Binance and Bybit market data.",
        lifespan=lifespan,
    )
    application.state.market_state = state
    application.state.market_service = service
    application.state.market_settings = resolved_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.cors_allowed_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    application.include_router(router)
    return application


app = create_app()
