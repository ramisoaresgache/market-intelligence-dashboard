from fastapi.testclient import TestClient

from app.main import create_app


def test_health_and_symbols() -> None:
    with TestClient(create_app(start_workers=False)) as client:
        health = client.get("/api/health")
        symbols = client.get("/api/symbols")

    assert health.status_code == 200
    assert health.json()["status"] == "degraded"
    assert symbols.json()["symbols"] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]


def test_unknown_symbol_is_404() -> None:
    with TestClient(create_app(start_workers=False)) as client:
        response = client.get("/api/orderbook/DOGEUSDT")
    assert response.status_code == 404


def test_orderbook_query_validation() -> None:
    with TestClient(create_app(start_workers=False)) as client:
        response = client.get("/api/orderbook/BTCUSDT?depth=0")
    assert response.status_code == 422


def test_market_websocket_starts_with_snapshot() -> None:
    with TestClient(create_app(start_workers=False)) as client:
        with client.websocket_connect("/ws/market?symbols=BTCUSDT") as websocket:
            message = websocket.receive_json()

    assert message["type"] == "market.snapshot"
    assert message["data"]["symbol"] == "BTCUSDT"
