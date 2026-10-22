import { describe, expect, it } from "vitest";
import * as tables from "../tables.js";

// The codecs, `discoverDevices` and the simulators read each value from one
// table, so a wrong one would be wrong on both sides and they would still
// agree. Each table is written out a second time here.
describe("the shared tables", () => {
  it("hold every value as an adapter does", () => {
    expect({ ...tables }).toEqual({
      DAIKIN_DISCOVERY_PROBE: "DAIKIN_UDP/common/basic_info",
      DAIKIN_DISCOVERY_PORT: 30050,
      DAIKIN_TERMINAL_UUID_HEADER: "X-Daikin-uuid",
    });
  });
});
