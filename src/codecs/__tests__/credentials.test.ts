import { describe, expect, it } from "vitest";
import {
  encodeClassicLocalPassword,
  encodeDsiotLocalPassword,
  encodeTerminalUuid,
} from "../credentials.js";

describe("encodeTerminalUuid", () => {
  it("is the X-Daikin-uuid header, holding the uuid as given", () => {
    expect(encodeTerminalUuid("0123456789abcdef0123456789abcdef")).toEqual({
      "X-Daikin-uuid": "0123456789abcdef0123456789abcdef",
    });
  });

  it.each([
    ["is empty", ""],
    ["is uppercase", "0123456789ABCDEF0123456789ABCDEF"],
    ["has a UUID's dashes", "01234567-89ab-cdef-0123-456789abcdef"],
    ["has a digit that is not hexadecimal", "0123456789abcdef0123456789abcdeg"],
    ["is a digit short", "0123456789abcdef0123456789abcde"],
    ["is a digit long", "0123456789abcdef0123456789abcdef0"],
    ["has a space after it", "0123456789abcdef0123456789abcdef "],
  ])("throws an Error for a uuid that %s", (_fault, uuid) => {
    expect(() => encodeTerminalUuid(uuid)).toThrow(
      "The terminal uuid must be 32 lowercase hexadecimal digits",
    );
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
