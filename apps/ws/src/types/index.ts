type PublicEventType = "BOOK" | "TRADE" | "TICKER" | "CANDLE" | "FUNDING";

type SocketData = { user_id: string | null };


export type {PublicEventType,SocketData}