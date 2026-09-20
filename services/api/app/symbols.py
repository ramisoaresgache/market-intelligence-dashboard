from app.config import SYMBOLS


class UnknownSymbolError(ValueError):
    pass


class SymbolMapper:
    def __init__(self, symbols: tuple[str, ...] = SYMBOLS) -> None:
        self._symbols = frozenset(symbols)

    def normalize(self, symbol: str) -> str:
        normalized = symbol.upper().replace("-", "")
        if normalized not in self._symbols:
            raise UnknownSymbolError(f"Unsupported symbol: {symbol}")
        return normalized

    def for_binance(self, symbol: str) -> str:
        return self.normalize(symbol).lower()

    def for_bybit(self, symbol: str) -> str:
        return self.normalize(symbol)


symbol_mapper = SymbolMapper()
