import { describe, expect, it } from "vitest";
import { parseDsiotCapabilities } from "../capabilities.js";
import { DSIOT_PATHS } from "../state.js";
import {
  INDOOR_STATUS,
  louverMask,
  modeLeaf,
} from "./fixtures/indoorStatus.js";

const COOL_SETPOINT = modeLeaf("p_02");
const HEAT_SETPOINT = modeLeaf("p_03");
const COOL_FAN_SPEED = modeLeaf("p_09");
const COOL_VERTICAL = modeLeaf("p_05");
const COOL_HORIZONTAL = modeLeaf("p_06");
const HEAT_VERTICAL = modeLeaf("p_07");
const COOL_HUMIDITY_FLAG = modeLeaf("p_0C");
const HEAT_HUMIDITY_FLAG = modeLeaf("p_2D");
const DEHUMIDIFY_HUMIDITY_FLAG = modeLeaf("p_31");

// The `adp_i` and indoor `dgc_status` trees of a unit that reports no `md`.
const UNIT = { "adp_i.reg": "sg", "adp_i.kind": "4", ...INDOOR_STATUS };

function without(
  values: Record<string, string>,
  ...paths: string[]
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([path]) => !paths.includes(path)),
  );
}

describe("parseDsiotCapabilities", () => {
  it("reads the adp_i and indoor dgc_status trees", () => {
    expect(parseDsiotCapabilities(UNIT)).toEqual({
      modes: ["auto", "dehumidify", "cool", "heat", "fan"],
      fanSpeeds: [
        "auto",
        "silent",
        "level1",
        "level2",
        "level3",
        "level4",
        "level5",
      ],
      swingModes: ["off", "vertical", "horizontal", "both"],
      verticalPositions: ["stop", "swing"],
      horizontalPositions: ["stop"],
      targetTemperatureInC: {
        auto: { min: 18, max: 30, step: 0.5 },
        cool: { min: 18, max: 32, step: 0.5 },
        heat: { min: 10, max: 30, step: 0.5 },
        dehumidify: null,
        fan: null,
      },
      targetHumidity: { auto: [], dehumidify: [], cool: [], heat: [], fan: [] },
      specialOutlet: false,
      energyMonitoring: false,
      demandControl: false,
      scheduleTimer: false,
    });
  });

  describe("modes", () => {
    it("offers dehumidify, cool and fan when the model type is 01", () => {
      const coolingOnly = parseDsiotCapabilities({
        ...UNIT,
        [DSIOT_PATHS.modelType]: "01",
      });

      expect(coolingOnly.modes).toEqual(["dehumidify", "cool", "fan"]);
      expect(coolingOnly.targetTemperatureInC.heat).toBeNull();
      expect(coolingOnly.targetTemperatureInC.auto).toBeNull();
    });
  });

  describe("targetTemperatureInC", () => {
    it("reads the cool and heat limits from md.mi and md.mx, in half degrees", () => {
      const { targetTemperatureInC } = parseDsiotCapabilities({
        ...UNIT,
        [`${COOL_SETPOINT}.md.mi`]: "2800",
        [`${COOL_SETPOINT}.md.mx`]: "3800",
        [HEAT_SETPOINT]: "2C00",
        [`${HEAT_SETPOINT}.md.mi`]: "1800",
        [`${HEAT_SETPOINT}.md.mx`]: "3400",
      });

      expect(targetTemperatureInC.cool).toEqual({
        min: 20,
        max: 28,
        step: 0.5,
      });
      expect(targetTemperatureInC.heat).toEqual({
        min: 12,
        max: 26,
        step: 0.5,
      });
    });

    it("caps the cool limit at 32 °C and the heat limit at 30 °C", () => {
      const { targetTemperatureInC } = parseDsiotCapabilities({
        ...UNIT,
        [`${COOL_SETPOINT}.md.mi`]: "2400",
        [`${COOL_SETPOINT}.md.mx`]: "4600",
        [`${HEAT_SETPOINT}.md.mi`]: "1400",
        [`${HEAT_SETPOINT}.md.mx`]: "4000",
      });

      expect(targetTemperatureInC.cool).toEqual({
        min: 18,
        max: 32,
        step: 0.5,
      });
      expect(targetTemperatureInC.heat).toEqual({
        min: 10,
        max: 30,
        step: 0.5,
      });
    });

    it("keeps a limit that falls on a half degree", () => {
      const { targetTemperatureInC } = parseDsiotCapabilities({
        ...UNIT,
        [`${COOL_SETPOINT}.md.mi`]: "2300",
        [`${COOL_SETPOINT}.md.mx`]: "3900",
      });

      expect(targetTemperatureInC.cool).toEqual({
        min: 17.5,
        max: 28.5,
        step: 0.5,
      });
    });

    it("ignores a limit that came without the other", () => {
      const { targetTemperatureInC } = parseDsiotCapabilities({
        ...UNIT,
        [`${COOL_SETPOINT}.md.mi`]: "2800",
      });

      expect(targetTemperatureInC.cool).toEqual({
        min: 18,
        max: 32,
        step: 0.5,
      });
    });
  });

  describe("fanSpeeds", () => {
    it("offers none when no mode has a fan speed leaf", () => {
      expect(
        parseDsiotCapabilities(without(UNIT, COOL_FAN_SPEED)).fanSpeeds,
      ).toEqual([]);
    });

    it("offers none without adp_i.reg", () => {
      expect(
        parseDsiotCapabilities(without(UNIT, "adp_i.reg")).fanSpeeds,
      ).toEqual([]);
    });
  });

  describe("swingModes", () => {
    it("offers vertical alone on a unit with only a vertical louver", () => {
      const verticalOnly = parseDsiotCapabilities(
        without(UNIT, COOL_HORIZONTAL),
      );

      expect(verticalOnly.swingModes).toEqual(["off", "vertical"]);
      expect(verticalOnly.verticalPositions).toEqual(["stop", "swing"]);
      expect(verticalOnly.horizontalPositions).toEqual([]);
    });

    it("offers horizontal alone on a unit with only a horizontal louver", () => {
      const horizontalOnly = parseDsiotCapabilities(
        without(UNIT, COOL_VERTICAL),
      );

      expect(horizontalOnly.swingModes).toEqual(["off", "horizontal"]);
      expect(horizontalOnly.verticalPositions).toEqual([]);
      expect(horizontalOnly.horizontalPositions).toEqual(["stop"]);
    });

    it("offers none on a unit without louver leaves", () => {
      const fixed = parseDsiotCapabilities(
        without(UNIT, COOL_VERTICAL, COOL_HORIZONTAL),
      );

      expect(fixed.swingModes).toEqual([]);
      expect(fixed.verticalPositions).toEqual([]);
      expect(fixed.horizontalPositions).toEqual([]);
    });
  });

  describe("louver positions", () => {
    it("offers each vertical position whose value md.mx allows", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_VERTICAL}.md.mx`]: louverMask(0, 15, 16, 19, 25),
        }).verticalPositions,
      ).toEqual(["stop", "swing", "naturalWind", "auto", "floorWarming"]);
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_VERTICAL}.md.mx`]: louverMask(15),
        }).verticalPositions,
      ).toEqual(["swing"]);
    });

    it("offers one fixed vertical position for each fixed value md.mx allows", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_VERTICAL}.md.mx`]: louverMask(0, 1, 2, 3, 4, 5, 15),
        }).verticalPositions,
      ).toEqual([
        "stop",
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
        "swing",
      ]);
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_VERTICAL}.md.mx`]: louverMask(0, 2, 4, 6, 15, 25),
        }).verticalPositions,
      ).toEqual([
        "stop",
        "position1",
        "position2",
        "position3",
        "swing",
        "floorWarming",
      ]);
    });

    it("offers five fixed vertical positions when md.mx allows more", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_VERTICAL}.md.mx`]: louverMask(1, 2, 3, 4, 5, 6, 7),
        }).verticalPositions,
      ).toEqual([
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
      ]);
    });

    it("offers what any mode's md.mx allows", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_VERTICAL}.md.mx`]: louverMask(0, 15),
          [HEAT_VERTICAL]: "000000",
          [`${HEAT_VERTICAL}.md.mx`]: louverMask(0, 25),
        }).verticalPositions,
      ).toEqual(["stop", "swing", "floorWarming"]);
    });

    it("offers the horizontal stop, and the swing and auto md.mx allows", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_HORIZONTAL}.md.mx`]: louverMask(0, 3, 15),
        }).horizontalPositions,
      ).toEqual(["stop", "swing"]);
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [`${COOL_HORIZONTAL}.md.mx`]: louverMask(3, 15, 16),
        }).horizontalPositions,
      ).toEqual(["stop", "swing", "auto"]);
    });
  });

  describe("targetHumidity", () => {
    const SETTINGS = ["autoLow", "auto", "autoHigh", "continuous"];

    it("offers the settings in each mode that has a humidity flag leaf, without off in dehumidify", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [COOL_HUMIDITY_FLAG]: "01",
          [DEHUMIDIFY_HUMIDITY_FLAG]: "00",
        }).targetHumidity,
      ).toEqual({
        auto: [],
        dehumidify: SETTINGS,
        cool: ["off", ...SETTINGS],
        heat: [],
        fan: [],
      });
    });

    it("is offered only in a mode the unit offers", () => {
      expect(
        parseDsiotCapabilities({
          ...UNIT,
          [DSIOT_PATHS.modelType]: "01",
          [COOL_HUMIDITY_FLAG]: "00",
          [HEAT_HUMIDITY_FLAG]: "00",
        }).targetHumidity,
      ).toMatchObject({ cool: ["off", ...SETTINGS], heat: [] });
    });
  });

  describe("energyMonitoring", () => {
    const monitored = {
      ...UNIT,
      "adp_i.func.en_ipower": "1",
      [DSIOT_PATHS.energyMonitoring]: "01",
    };

    it("is set when the adapter enables it and the unit reports it", () => {
      expect(parseDsiotCapabilities(monitored).energyMonitoring).toBe(true);
    });

    it("is not set when either is missing", () => {
      expect(
        parseDsiotCapabilities(without(monitored, "adp_i.func.en_ipower"))
          .energyMonitoring,
      ).toBe(false);
      expect(
        parseDsiotCapabilities({
          ...monitored,
          [DSIOT_PATHS.energyMonitoring]: "00",
        }).energyMonitoring,
      ).toBe(false);
    });
  });

  describe("demandControl", () => {
    const demand = {
      ...UNIT,
      "adp_i.func.en_ipower": "1",
      "adp_i.func.en_demand": "1",
      [DSIOT_PATHS.energyMonitoring]: "01",
    };

    it("is set when the adapter enables it on a unit with energy monitoring", () => {
      expect(parseDsiotCapabilities(demand).demandControl).toBe(true);
    });

    it("is not set without energy monitoring", () => {
      expect(
        parseDsiotCapabilities(without(demand, DSIOT_PATHS.energyMonitoring))
          .demandControl,
      ).toBe(false);
    });

    it("is not set unless adp_i.kind is 4", () => {
      expect(
        parseDsiotCapabilities({ ...demand, "adp_i.kind": "3" }).demandControl,
      ).toBe(false);
    });
  });

  describe("scheduleTimer", () => {
    it("is set when adp_i.func.en_scdltmr is 1", () => {
      expect(
        parseDsiotCapabilities({ ...UNIT, "adp_i.func.en_scdltmr": "1" })
          .scheduleTimer,
      ).toBe(true);
    });
  });

  describe("model", () => {
    it("is the unit's model leaf", () => {
      expect(
        parseDsiotCapabilities({ ...UNIT, [DSIOT_PATHS.model]: "0ABB" }).model,
      ).toBe("0ABB");
    });
  });
});
