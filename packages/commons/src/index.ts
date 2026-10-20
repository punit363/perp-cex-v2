import type { OrderSide, OrderType } from "./order.type"

export type RequestToEngine ={
    action:"ONRAMP",
    user_id:string,
    amount:string
}|{
    action:"PLACE_ORDER",
    user_id:string,
    market_id:string,
    price:string,
    quantity:string,
    side:OrderSide,
    type:OrderType,
    equity:string,
    order_id:string
}|{
    action:"CANCEL_ORDER",
    user_id:string,
    order_id:string
}|{
    action:"CREATE_MARKET",
    market_id:string
}
