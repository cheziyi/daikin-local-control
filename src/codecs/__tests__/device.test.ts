import { describe, expect, it } from "vitest";
import { isAirConditioner, parseDevice, parseDeviceInfo } from "../device.js";

describe("isAirConditioner", () => {
  it("passes a classic adapter that reports type=aircon", () => {
    expect(isAirConditioner({ type: "aircon" })).toBe(true);
  });

  it("passes a DSIOT adapter unless its cdev is an air cleaner's", () => {
    expect(isAirConditioner({ type: "GPF" })).toBe(true);
    expect(isAirConditioner({ type: "GPF", cdev: "RA" })).toBe(true);
    expect(isAirConditioner({ type: "GPF", cdev: "1D" })).toBe(false);
    expect(isAirConditioner({ type: "GPF", cdev: "CJ" })).toBe(false);
  });

  it("passes no other type, and no reply without one", () => {
    for (const type of [
      "cleaner",
      "Water Heater",
      "Floor Heater",
      "circulator",
      "common_adp",
      "hotwater",
    ]) {
      expect(isAirConditioner({ type })).toBe(false);
    }
    expect(isAirConditioner({})).toBe(false);
  });
});

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

  it("reads the MAC address in pairs joined by colons, keeping its letter case", () => {
    expect(
      parseDevice("192.168.1.54", { mac: "A408EACC91D4" }).macAddress,
    ).toBe("A4:08:EA:CC:91:D4");
    expect(
      parseDevice("192.168.1.54", { mac: "a408eacc91d4" }).macAddress,
    ).toBe("a4:08:ea:cc:91:d4");
  });

  it("reads the firmware version as its three numbers joined by dots", () => {
    expect(parseDevice("192.168.1.54", { ver: "1_2_51" }).firmwareVersion).toBe(
      "1.2.51",
    );
    expect(
      parseDevice("192.168.1.54", { ver: "1_02_51" }).firmwareVersion,
    ).toBe("1.2.51");
  });

  it("marks a pre-release firmware version, and drops any other fourth part", () => {
    expect(
      parseDevice("192.168.1.54", { ver: "3_3_6_pre" }).firmwareVersion,
    ).toBe("3.3.6.pre");
    expect(
      parseDevice("192.168.1.54", { ver: "3_3_6_rc" }).firmwareVersion,
    ).toBe("3.3.6");
  });

  it("leaves out a firmware version that is not three numbers", () => {
    expect(
      parseDevice("192.168.1.54", { ver: "1_2" }).firmwareVersion,
    ).toBeUndefined();
    expect(
      parseDevice("192.168.1.54", { ver: "1_2_x" }).firmwareVersion,
    ).toBeUndefined();
  });

  it("leaves out the MAC address and firmware version when the reply has none", () => {
    const device = parseDevice("192.168.1.54", { mac: "" });

    expect(device.macAddress).toBeUndefined();
    expect(device.firmwareVersion).toBeUndefined();
  });
});

describe("parseDeviceInfo", () => {
  it("reads the name, MAC address and firmware version alone", () => {
    expect(
      parseDeviceInfo({
        ret: "OK",
        type: "aircon",
        name: "Living+room",
        mac: "A408EACC91D4",
        ver: "1_2_51",
      }),
    ).toEqual({
      name: "Living room",
      macAddress: "A4:08:EA:CC:91:D4",
      firmwareVersion: "1.2.51",
    });
  });
});
