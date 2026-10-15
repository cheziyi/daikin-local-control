import { describe, expect, it } from "vitest";
import * as tables from "../tables.js";

// The codec reads each code from one table. Each table is written out a
// second time here, so a wrong code is caught wherever it is used.
describe("the Airbase tables", () => {
  it("hold every code as an adapter does", () => {
    expect({ ...tables }).toEqual({
      AIRBASE_OPERATING_MODE_CODES: {
        fan: "0",
        heat: "1",
        cool: "2",
        auto: "3",
        dehumidify: "7",
      },
      AIRBASE_FAN_SPEED_CODES: {
        auto: "0",
        silent: "B",
        level1: "1",
        level2: "2",
        level3: "3",
        level4: "4",
        level5: "5",
      },
      AIRBASE_SWING_MODE_CODES: {
        off: "0",
        vertical: "1",
        horizontal: "2",
        "3d": "3",
      },
      AIRBASE_NO_SETPOINT: "--",
    });
  });
});
