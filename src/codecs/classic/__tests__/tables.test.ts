import { describe, expect, it } from "vitest";
import * as tables from "../tables.js";

// The codecs and the simulators read each code from one table, so a wrong code
// would be wrong on both sides and they would still agree. Each table is
// written out a second time here.
describe("the classic tables", () => {
  it("hold every code as an adapter does", () => {
    expect({ ...tables }).toEqual({
      CLASSIC_OPERATING_MODE_CODES: {
        auto: "1",
        dehumidify: "2",
        cool: "3",
        heat: "4",
        fan: "6",
      },
      CLASSIC_FAN_SPEED_CODES: {
        auto: "A",
        silent: "B",
        level1: "3",
        level2: "4",
        level3: "5",
        level4: "6",
        level5: "7",
      },
      CLASSIC_SWING_MODE_CODES: {
        off: "0",
        vertical: "1",
        horizontal: "2",
        "3d": "3",
      },
      CLASSIC_LOUVER_STOP: "0",
      CLASSIC_LOUVER_SWING: "S",
      CLASSIC_VERTICAL_POSITION_CODES: {
        stop: "0",
        position1: "1",
        position2: "2",
        position3: "3",
        position4: "4",
        position5: "5",
        swing: "S",
        naturalWind: "N",
        auto: "A",
        floorWarming: "F",
      },
      CLASSIC_HORIZONTAL_POSITION_CODES: {
        stop: "0",
        position1: "1",
        position2: "2",
        position3: "3",
        position4: "4",
        position5: "5",
        swing: "S",
        auto: "A",
      },
      CLASSIC_HUMIDITY_SETTING_CODES: {
        off: "0",
        autoLow: "AUTO_L",
        auto: "AUTO",
        autoHigh: "AUTO_H",
        continuous: "CONTINUE",
      },
      CLASSIC_NO_SETPOINT: "--",
      CLASSIC_SPECIAL_MODE_ADV_CODES: {
        powerful: "2",
        econo: "12",
        streamer: "13",
      },
      CLASSIC_SPECIAL_MODE_KIND_CODES: { powerful: "1", econo: "2" },
      CLASSIC_SPECIAL_MODE_BITS: { powerful: 1, econo: 2, streamer: 4 },
      CLASSIC_ADAPTER_TYPE: "aircon",
      CLASSIC_COOLING_ONLY_TYPE: "C",
      CLASSIC_TERMINAL_SCOPE_CODES: { self: "0", others: "1", all: "2" },
      CLASSIC_REMOTE_METHODS: { polling: "polling", homeOnly: "home only" },
    });
  });
});
