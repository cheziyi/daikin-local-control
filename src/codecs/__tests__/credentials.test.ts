import { describe, expect, it } from "vitest";
import {
  encodeClassicLocalPassword,
  encodeDsiotLocalPassword,
  encodeTerminalUuid,
} from "../credentials.js";

describe("encodeTerminalUuid", () => {
  it("is the X-Daikin-uuid header, without the uuid's dashes", () => {
    expect(encodeTerminalUuid("01234567-89ab-cdef-0123-456789abcdef")).toEqual({
      "X-Daikin-uuid": "0123456789abcdef0123456789abcdef",
    });
  });
});

describe("encodeClassicLocalPassword", () => {
  it("is the lpw query parameter", () => {
    expect(encodeClassicLocalPassword("1234")).toEqual({ lpw: "1234" });
  });
});

describe("encodeDsiotLocalPassword", () => {
  it("is a Basic Authorization header", () => {
    expect(encodeDsiotLocalPassword("1234")).toEqual({
      Authorization: "Basic 1234",
    });
  });
});
