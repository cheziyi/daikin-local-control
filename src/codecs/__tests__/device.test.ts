import { describe, expect, it } from "vitest";
import { parseDevice } from "../device.js";

describe("parseDevice", () => {
  it("reads a classic adapter outside secure mode and without a child lock", () => {
    expect(
      parseDevice("192.168.1.50", {
        ret: "OK",
        type: "aircon",
        name: "Bedroom",
        adp_kind: "3",
        en_secure: "0",
        lpw_flag: "0",
      }),
    ).toEqual({
      host: "192.168.1.50",
      protocol: "classic",
      name: "Bedroom",
      requiresRegistration: false,
      usesHttps: false,
      requiresLocalPassword: false,
    });
  });

  it("requires registration of a classic adapter in secure mode", () => {
    expect(
      parseDevice("192.168.1.51", { adp_kind: "2", en_secure: "1" }),
    ).toMatchObject({ requiresRegistration: true, usesHttps: false });
  });

  it("uses HTTPS only for a Marvell adapter in secure mode", () => {
    expect(
      parseDevice("192.168.1.50", { adp_kind: "3", en_secure: "1" }),
    ).toMatchObject({ requiresRegistration: true, usesHttps: true });
    expect(
      parseDevice("192.168.1.50", { adp_kind: "3", en_secure: "0" }),
    ).toMatchObject({ requiresRegistration: false, usesHttps: false });
  });

  it("reads type=GPF as DSIOT, on HTTP and without registration", () => {
    expect(
      parseDevice("192.168.1.52", {
        type: "GPF",
        adp_kind: "3",
        en_secure: "1",
      }),
    ).toMatchObject({
      protocol: "dsiot",
      requiresRegistration: false,
      usesHttps: false,
    });
  });

  it("reads any other type as classic", () => {
    expect(
      parseDevice("192.168.1.52", { type: "aircon", adp_kind: "4" }).protocol,
    ).toBe("classic");
    expect(parseDevice("192.168.1.52", {}).protocol).toBe("classic");
  });

  it("reads the child lock flag independently of secure mode", () => {
    expect(
      parseDevice("192.168.1.53", {
        adp_kind: "3",
        en_secure: "0",
        lpw_flag: "1",
      }),
    ).toMatchObject({
      requiresRegistration: false,
      requiresLocalPassword: true,
    });
  });

  it("appends the announced api_port to the host", () => {
    expect(parseDevice("192.168.1.54", { api_port: "8080" }).host).toBe(
      "192.168.1.54:8080",
    );
    expect(parseDevice("192.168.1.54", {}).host).toBe("192.168.1.54");
  });

  it("decodes the name, reading + as a space", () => {
    expect(parseDevice("192.168.1.54", { name: "Living+Room%20A" }).name).toBe(
      "Living Room A",
    );
  });

  it("keeps a name that is not valid percent-encoding as the adapter sent it", () => {
    expect(parseDevice("192.168.1.54", { name: "100%+humid" }).name).toBe(
      "100%+humid",
    );
  });

  it("leaves out the name when the reply has none", () => {
    expect(parseDevice("192.168.1.54", {}).name).toBeUndefined();
  });
});
