from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.service import MarketService
from app.state import StateManager


def create_app(*, start_workers: bool = True) -> FastAPI:
    state = StateManager()
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

    application = FastAPI(
        title="Market Intelligence API",
        version="0.1.0",
        description="Read-only normalized Binance and Bybit market data.",
        lifespan=lifespan,
    )
    application.state.market_state = state
    application.state.market_service = service
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    application.include_router(router)
    return application


app = create_app()
