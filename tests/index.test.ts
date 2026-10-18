import axios, { AxiosError } from "axios";
import { describe, expect, it } from "bun:test";
import { BACKEND } from "./config";

describe("auth endpoints", () => {
  const username = "Punit" + `${Math.random()}`;

  it("Signup doesnt work if username is not provided", async () => {
    try {
      const response = await axios.post(`${BACKEND}/api/v1/signup`, {
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
      const response = await axios.post(`${BACKEND}/api/v1/signin`, {
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
      const response = await axios.post(`${BACKEND}/api/v1/signin`, {
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
    const response = await axios.post(`${BACKEND}/api/v1/signin`, {
      username: "Punit0.9603035186041282",
      password: "12345678",
    });
    expect(response.data.data.token).not.toBe(undefined);
  });
});
