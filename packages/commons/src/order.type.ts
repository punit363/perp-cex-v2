enum OrderStatus {
  OPEN = "OPEN",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
}

enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

enum OrderType {
  MARKET = "MARKET",
  LIMIT = "LIMIT",
}

enum PositionType {
  LONG = "LONG",
  SHORT = "SHORT",
}

export { OrderStatus, OrderType, OrderSide, PositionType };
