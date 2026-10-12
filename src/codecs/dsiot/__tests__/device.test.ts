import { describe, expect, it } from "vitest";
import { parseDsiotDeviceInfo } from "../device.js";

describe("parseDsiotDeviceInfo", () => {
  it("reads the MAC address and firmware version from the adp_i tree", () => {
    expect(
      parseDsiotDeviceInfo({
        "adp_i.mac": "A408EACC91D4",
        "adp_i.ver": "1_14_88",
      }),
    ).toEqual({ macAddress: "A4:08:EA:CC:91:D4", firmwareVersion: "1.14.88" });
  });

  it("leaves out each one the tree does not carry", () => {
    expect(parseDsiotDeviceInfo({ "adp_i.reg": "sg" })).toEqual({});
  });
});
