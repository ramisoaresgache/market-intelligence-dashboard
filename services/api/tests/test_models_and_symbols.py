import pytest

from app.models import OrderLevel
from app.symbols import SymbolMapper, UnknownSymbolError


def test_order_level_notional_is_explicit() -> None:
    level = OrderLevel(price=100.0, qty=2.5, notional=250.0)
    assert level.notional == 250.0


def test_symbol_mapper_normalizes_exchange_spelling() -> None:
    mapper = SymbolMapper()
    assert mapper.normalize("btc-usdt") == "BTCUSDT"
    assert mapper.for_binance("ETHUSDT") == "ethusdt"
    assert mapper.for_bybit("solusdt") == "SOLUSDT"


def test_symbol_mapper_rejects_unknown_symbol() -> None:
    with pytest.raises(UnknownSymbolError):
        SymbolMapper().normalize("DOGEUSDT")
