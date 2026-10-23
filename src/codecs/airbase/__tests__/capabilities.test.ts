import { describe, expect, it } from "vitest";
import {
  mergeAirbaseCapabilityFields,
  parseAirbaseCapabilities,
  parseAirbaseZoneCount,
  setsAirbaseZoneTemperatures,
  takesAirbaseAirside,
  takesAirbaseFanAuto,
} from "../capabilities.js";

// A unit without zones that takes every mode, an auto fan speed and a
// direction.
const UNZONED = {
  reg: "au",
  model: "NOTSUPPORT",
  en_auto: "1",
  en_dry: "1",
  en_frate: "1",
  en_frate_auto: "1",
  frate_steps: "3",
  en_fdir: "1",
  cool_l: "16",
  cool_h: "32",
  heat_l: "14",
  heat_h: "28",
};
// A unit with four zones that takes fan auto and airside.
const ZONED = {
  ...UNZONED,
  en_zone: "4",
  en_airside: "1",
};

describe("mergeAirbaseCapabilityFields", () => {
  it("merges the two replies, the model's fields over the adapter's", () => {
    expect(
      mergeAirbaseCapabilityFields(
        { ret: "OK", reg: "au", type: "aircon" },
        { ret: "OK", type: "N", en_zone: "4" },
      ),
    ).toEqual({ ret: "OK", reg: "au", type: "N", en_zone: "4" });
  });
});

describe("parseAirbaseCapabilities", () => {
  it("reads a unit without zones", () => {
    expect(parseAirbaseCapabilities(UNZONED)).toEqual({
      modes: ["auto", "dehumidify", "cool", "heat", "fan"],
      fanSpeeds: ["auto", "level1", "level3", "level5"],
      swingModes: [],
      verticalPositions: [
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
        "swing",
      ],
      horizontalPositions: [],
      targetTemperaturesInC: {
        auto: { min: 16, max: 28, step: 1 },
        cool: { min: 16, max: 32, step: 1 },
        heat: { min: 14, max: 28, step: 1 },
        dehumidify: null,
        fan: null,
      },
      targetHumidities: {
        auto: [],
        dehumidify: [],
        cool: [],
        heat: [],
        fan: [],
      },
      specialModes: { auto: [], dehumidify: [], cool: [], heat: [], fan: [] },
      specialOutlet: false,
      energyMonitoring: false,
      demandControl: false,
      scheduleTimer: false,
      model: "NOTSUPPORT",
    });
  });

  it("offers auto and dehumidify only to a unit that reports them", () => {
    const { en_auto: _auto, en_dry: _dry, ...basic } = UNZONED;

    expect(parseAirbaseCapabilities(basic)).toMatchObject({
      modes: ["cool", "heat", "fan"],
      targetTemperaturesInC: { auto: null },
    });
    expect(parseAirbaseCapabilities({ ...basic, en_dry: "1" }).modes).toEqual([
      "dehumidify",
      "cool",
      "heat",
      "fan",
    ]);
  });

  it("falls back to 18-32 for cool, 10-30 for heat and 18-30 for auto", () => {
    expect(
      parseAirbaseCapabilities({ en_auto: "1" }).targetTemperaturesInC,
    ).toMatchObject({
      auto: { min: 18, max: 30, step: 1 },
      cool: { min: 18, max: 32, step: 1 },
      heat: { min: 10, max: 30, step: 1 },
    });
  });

  it("drops the fraction of a limit", () => {
    expect(
      parseAirbaseCapabilities({ cool_l: "16.5", cool_h: "31.9" })
        .targetTemperaturesInC.cool,
    ).toEqual({ min: 16, max: 31, step: 1 });
  });

  it("offers a unit with zones no auto fan speed and no direction", () => {
    expect(parseAirbaseCapabilities(ZONED)).toMatchObject({
      fanSpeeds: ["level1", "level3", "level5"],
      verticalPositions: [],
    });
    expect(
      parseAirbaseCapabilities({ ...UNZONED, en_zone: "0" }),
    ).toMatchObject({
      fanSpeeds: ["auto", "level1", "level3", "level5"],
      verticalPositions: [
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
        "swing",
      ],
    });
  });

  it("offers two fan levels when frate_steps is 2, and three without it", () => {
    const { frate_steps: _, ...uncounted } = ZONED;

    expect(
      parseAirbaseCapabilities({ ...ZONED, frate_steps: "2" }).fanSpeeds,
    ).toEqual(["level1", "level5"]);
    expect(parseAirbaseCapabilities(uncounted).fanSpeeds).toEqual([
      "level1",
      "level3",
      "level5",
    ]);
    expect(
      parseAirbaseCapabilities({ ...ZONED, frate_steps: "" }).fanSpeeds,
    ).toEqual([]);
  });

  it("offers no fan speed to a unit whose fan cannot be set", () => {
    const { reg: _, ...withoutRegion } = UNZONED;

    for (const fields of [
      { ...UNZONED, en_frate: "0" },
      { ...UNZONED, reg: "jp" },
      withoutRegion,
      { ...ZONED, en_linear_zone: "1" },
    ]) {
      expect(parseAirbaseCapabilities(fields).fanSpeeds).toEqual([]);
    }
  });

  it("offers no auto fan speed unless en_frate_auto is 1", () => {
    expect(
      parseAirbaseCapabilities({ ...UNZONED, en_frate_auto: "0" }).fanSpeeds,
    ).toEqual(["level1", "level3", "level5"]);
  });

  it("offers no direction unless en_fdir is 1", () => {
    expect(
      parseAirbaseCapabilities({ ...UNZONED, en_fdir: "0" }).verticalPositions,
    ).toEqual([]);
  });

  it("reads the schedule timer from en_scdltmr", () => {
    expect(parseAirbaseCapabilities({ en_scdltmr: "1" }).scheduleTimer).toBe(
      true,
    );
    expect(parseAirbaseCapabilities({ en_scdltmr: "2" }).scheduleTimer).toBe(
      true,
    );
    expect(parseAirbaseCapabilities({ en_scdltmr: "0" }).scheduleTimer).toBe(
      false,
    );
  });
});

describe("takesAirbaseFanAuto", () => {
  it("passes a unit with zones that counts its fan speeds", () => {
    const { en_frate_auto: _, ...unsaid } = ZONED;

    expect(takesAirbaseFanAuto(ZONED)).toBe(true);
    expect(takesAirbaseFanAuto(unsaid)).toBe(true);
  });

  it("passes no other unit", () => {
    const { frate_steps: _, ...uncounted } = ZONED;

    for (const fields of [
      UNZONED,
      uncounted,
      { ...ZONED, en_frate_auto: "0" },
      { ...ZONED, en_frate: "0" },
      { ...ZONED, en_linear_zone: "1" },
      { ...ZONED, frate_steps: "" },
    ]) {
      expect(takesAirbaseFanAuto(fields)).toBe(false);
    }
  });
});

describe("takesAirbaseAirside", () => {
  it("passes a unit with zones that reports en_airside=1, and no other", () => {
    expect(takesAirbaseAirside(ZONED)).toBe(true);
    expect(takesAirbaseAirside({ ...UNZONED, en_airside: "1" })).toBe(false);
    expect(takesAirbaseAirside({ ...ZONED, en_airside: "0" })).toBe(false);
    expect(takesAirbaseAirside({ ...ZONED, en_frate: "0" })).toBe(false);
  });
});

describe("setsAirbaseZoneTemperatures", () => {
  it("passes a unit that reports en_linear_zone=1, and no other", () => {
    expect(setsAirbaseZoneTemperatures({ en_linear_zone: "1" })).toBe(true);
    expect(setsAirbaseZoneTemperatures({ en_linear_zone: "0" })).toBe(false);
    expect(setsAirbaseZoneTemperatures(ZONED)).toBe(false);
  });
});

describe("parseAirbaseZoneCount", () => {
  it("reads en_zone, and none without it", () => {
    expect(parseAirbaseZoneCount({ en_zone: "4" })).toBe(4);
    expect(parseAirbaseZoneCount({ en_zone: "0" })).toBe(0);
    expect(parseAirbaseZoneCount({ en_zone: "x" })).toBe(0);
    expect(parseAirbaseZoneCount({})).toBe(0);
  });
});
