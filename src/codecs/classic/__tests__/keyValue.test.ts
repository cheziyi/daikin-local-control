import { describe, expect, it } from "vitest";
import { DaikinError } from "../../../error.js";
import {
  assertClassicOk,
  isClassicOk,
  parseClassicKeyValue,
} from "../keyValue.js";

describe("parseClassicKeyValue", () => {
  it("splits a reply into its fields", () => {
    expect(parseClassicKeyValue("ret=OK,pow=1,stemp=24.0")).toEqual({
      ret: "OK",
      pow: "1",
      stemp: "24.0",
    });
  });

  it("keeps an empty value", () => {
    expect(parseClassicKeyValue("ret=OK,adv=")).toEqual({ ret: "OK", adv: "" });
  });

  it("splits a pair at its first =", () => {
    expect(parseClassicKeyValue("name=a=b")).toEqual({ name: "a=b" });
  });

  it("keeps a value as the adapter sent it, undecoded", () => {
    expect(parseClassicKeyValue("name=Living%20Room+A")).toEqual({
      name: "Living%20Room+A",
    });
  });

  it("drops a pair without =", () => {
    expect(parseClassicKeyValue("ret=OK,garbage,pow=1")).toEqual({
      ret: "OK",
      pow: "1",
    });
    expect(parseClassicKeyValue("")).toEqual({});
  });
});

describe("isClassicOk", () => {
  it("is true when ret is OK", () => {
    expect(isClassicOk({ ret: "OK" })).toBe(true);
  });

  it("is false for any other ret, and for a reply without ret", () => {
    expect(isClassicOk({ ret: "PARAM NG" })).toBe(false);
    expect(isClassicOk({ pow: "1" })).toBe(false);
  });
});

describe("assertClassicOk", () => {
  it("returns when ret is OK", () => {
    expect(() => assertClassicOk({ ret: "OK" })).not.toThrow();
  });

  it.each(["AUTH NG", "LPW NG"])(
    "throws a DaikinError with status 401 for ret=%s",
    (ret) => {
      const assertion = () => assertClassicOk({ ret });

      expect(assertion).toThrow(DaikinError);
      expect(assertion).toThrow(`ret=${ret}`);
      expect(assertion).toThrow(
        expect.objectContaining({ httpStatusCode: 401 }),
      );
    },
  );

  it("throws a DaikinError with status 502 for any other ret", () => {
    const assertion = () => assertClassicOk({ ret: "PARAM NG" });

    expect(assertion).toThrow(DaikinError);
    expect(assertion).toThrow("ret=PARAM NG");
    expect(assertion).toThrow(expect.objectContaining({ httpStatusCode: 502 }));
  });

  it("throws a DaikinError with status 502 for a reply without ret", () => {
    const assertion = () => assertClassicOk({ pow: "1" });

    expect(assertion).toThrow("ret=missing");
    expect(assertion).toThrow(expect.objectContaining({ httpStatusCode: 502 }));
  });
});
