enum OrderStatus {
  OPEN,
  PARTIALLY_FILLED,
  CLOSED,
  CANCELLED,
}

enum OrderSide {
  LONG,
  SHORT,
}

enum OrderType {
  MARKET,
  LIMIT,
}

export { OrderStatus, OrderType, OrderSide };
