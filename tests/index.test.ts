import axios, { AxiosError } from "axios";
import { beforeAll, describe, expect, it } from "bun:test";
import { BACKEND_URL } from "./config";
import { password } from "bun";

describe("auth endpoints", () => {
  const username = "Punit" + `${Math.random()}`;

  it("Signup doesnt work if username is not provided", async () => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/v1/signup`, {
        username,
      });
      //if it does not throw err even without the username it should still fail
      expect().fail();

      //if the api throws an error axios will not return a response hence we shift the code to catch block
    } catch (error) {
      if (error instanceof AxiosError) {
        expect(error.response?.status).toBe(411);
      } else {
        //incase we have some other type of error other than axios it should still a fail
        expect(1).toBe(2);
      }
    }
  });

  it("Signin doesnt work if username is not provided", async () => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/v1/signin`, {
        password: "12345678",
      });

      expect().fail();
    } catch (error) {
      if (error instanceof AxiosError) {
        expect(error.response?.status).toBe(411);
      } else {
        expect(1).toBe(2);
      }
    }
  });

  it("Signin doesnt work if wrong password is provided", async () => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/v1/signin`, {
        username: "Punit0.9603035186041282",
        password: "87654321",
      });
      expect().fail();
    } catch (error) {
      if (error instanceof AxiosError) {
        expect(error.response?.status).toBe(403);
      } else {
        expect(1).toBe(2);
      }
    }
  });

  it("Signin works with correct credentials", async () => {
    const response = await axios.post(`${BACKEND_URL}/api/v1/signin`, {
      username: "Punit0.9603035186041282",
      password: "12345678",
    });
    expect(response.data.data.token).not.toBe(undefined);
  });
});

describe("order endpoints", () => {
  const USER1 = "1_Punit" + Math.random();
  const USER2 = "2_Punit" + Math.random();
  let TOKEN1: string;
  let TOKEN2: string;
  let MARKET: string;

  beforeAll(async () => {
    const response = await axios("/api/v1/admin/market", {
      headers: { token: "random123" },
    });
    MARKET = response.data.id;

    await axios.post(`${BACKEND_URL}/api/v1/signup`, {
      username: USER1,
      password: "12345678",
    });

    await axios.post(`${BACKEND_URL}/api/v1/signup`, {
      username: USER2,
      password: "12345678",
    });

    const response1 = await axios.post(`${BACKEND_URL}/api/v1/signin`, {
      username: USER1,
      password: "12345678",
    });

    const response2 = await axios.post(`${BACKEND_URL}/api/v1/signin`, {
      username: USER2,
      password: "12345678",
    });

    TOKEN1 = response1.data.data.token;
    TOKEN2 = response2.data.data.token;

    await axios.post(
      `${BACKEND_URL}api/v1/onramp`,
      {
        amount: 10000000,
      },
      {
        headers: {
          token: TOKEN1,
        },
      }
    );

    await axios.post(
      `${BACKEND_URL}api/v1/onramp`,
      {
        amount: 10000000,
      },
      {
        headers: {
          token: TOKEN2,
        },
      }
    );
  });

  it("first order must sit in the orderbook", async () => {
    const response = await axios.post(
      `${BACKEND_URL}/appi/v1/order`,
      {
        market_id: MARKET,
        type: "LIMIT",
        side: "SHORT",
        quantity: "20",
        price: "3000",
        equity: "1000",
      },
      {
        headers: {
          token: TOKEN1,
        },
      }
    );

    expect(response.status).toBe(200);
    expect(response.data.order.order_id).toBeDefined();
    expect(response.data.order.filled_qty).toBe(0);
  });

  it("second order must sit in the orderbook if not matched", async () => {
    const response = await axios.post(
      `${BACKEND_URL}/appi/v1/order`,
      {
        market_id: MARKET,
        type: "LIMIT",
        side: "LONG",
        quantity: "20",
        price: "2800",
        equity: "1000",
      },
      {
        headers: {
          token: TOKEN1,
        },
      }
    );

    expect(response.status).toBe(200);
    expect(response.data.order.order_id).toBeDefined();
    expect(response.data.order.filled_qty).toBe(0);
  });

  it("third order must match with another order from the orderbook", async () => {
    const response = await axios.post(
      `${BACKEND_URL}/appi/v1/order`,
      {
        market_id: MARKET,
        type: "LIMIT",
        side: "LONG",
        quantity: "15",
        price: "3100",
        equity: "1000",
      },
      {
        headers: {
          token: TOKEN1,
        },
      }
    );

    expect(response.status).toBe(200);
    expect(response.data.order.order_id).toBeDefined();
    expect(response.data.order.filled_qty).toBe(15);
    expect(response.data.fills.length()).not.toBe(0);
  });
});
