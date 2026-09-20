import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from app.config import EXCHANGES, SYMBOLS
from app.state import StateManager
from app.symbols import UnknownSymbolError, symbol_mapper

router = APIRouter()
WINDOWS_MS = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
}


def _state(request: Request) -> StateManager:
    return request.app.state.market_state  # type: ignore[no-any-return]


def _symbol_or_404(symbol: str) -> str:
    try:
        return symbol_mapper.normalize(symbol)
    except UnknownSymbolError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/health")
async def health(request: Request) -> dict[str, object]:
    return await _state(request).health()


@router.get("/api/symbols")
async def symbols() -> dict[str, object]:
    return {
        "symbols": list(SYMBOLS),
        "exchanges": list(EXCHANGES),
        "market_type": "perpetual",
    }


@router.get("/api/market/{symbol}/snapshot")
async def market_snapshot(symbol: str, request: Request) -> dict[str, object]:
    return await _state(request).snapshot(_symbol_or_404(symbol))


@router.get("/api/orderbook/{symbol}")
async def orderbook(
    symbol: str,
    request: Request,
    exchange: Literal["all", "binance", "bybit"] = "all",
    depth: int = Query(default=50, ge=1, le=200),
) -> dict[str, object]:
    normalized = _symbol_or_404(symbol)
    books = await _state(request).get_order_books(normalized, exchange, depth)
    return {"symbol": normalized, "exchange": exchange, "depth": depth, "books": books}


@router.get("/api/liquidations/{symbol}")
async def liquidations(
    symbol: str,
    request: Request,
    window: Literal["15m", "1h", "4h", "24h"] = "1h",
) -> dict[str, object]:
    normalized = _symbol_or_404(symbol)
    since_ms = int(time.time() * 1000) - WINDOWS_MS[window]
    events = await _state(request).get_liquidations(normalized, since_ms)
    return {"symbol": normalized, "window": window, "events": events}


@router.websocket("/ws/market")
async def market_websocket(websocket: WebSocket, symbols: str = "BTCUSDT,ETHUSDT,SOLUSDT") -> None:
    try:
        selected = {symbol_mapper.normalize(value.strip()) for value in symbols.split(",") if value}
    except UnknownSymbolError:
        await websocket.close(code=1008, reason="unsupported symbol")
        return

    await websocket.accept()
    state: StateManager = websocket.app.state.market_state
    queue = state.subscribe()
    try:
        for symbol in sorted(selected):
            await websocket.send_json(
                {"type": "market.snapshot", "data": await state.snapshot(symbol)}
            )
        while True:
            event = await queue.get()
            data = event.get("data", {})
            event_symbol = data.get("symbol") if isinstance(data, dict) else None
            if event_symbol is None or event_symbol in selected:
                await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        state.unsubscribe(queue)
