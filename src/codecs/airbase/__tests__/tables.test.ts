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
      AIRBASE_VERTICAL_POSITION_CODES: {
        position1: "0",
        position2: "1",
        position3: "2",
        position4: "3",
        position5: "4",
        swing: "7",
      },
      AIRBASE_VERTICAL_POSITION_ALIASES: { "6": "stop" },
      AIRBASE_NO_SETPOINT: "--",
      AIRBASE_ZONE_LIST_SEPARATOR: ";",
      AIRBASE_ZONE_TEMPERATURE_FIELDS: { cool: "lztemp_c", heat: "lztemp_h" },
    });
  });
});
