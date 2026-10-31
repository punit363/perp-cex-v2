import { randomUUID } from "node:crypto";

export const generate_order_id = () => `odr_${randomUUID()}`;
