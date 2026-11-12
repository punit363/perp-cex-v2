type PublicEventType = "BOOK" | "TRADE" | "TICKER" | "CANDLE" | "FUNDING";

type SocketData = {
  user_id: string | null;
  clientIp: string;
  messagesInWindow: number;
  windowStartedAt: number;
};


export type {PublicEventType,SocketData}
