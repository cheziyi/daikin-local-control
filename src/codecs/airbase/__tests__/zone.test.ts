import { describe, expect, it } from "vitest";
import { applyAirbaseZone, parseAirbaseZones } from "../zone.js";

const FOUR_ZONES = { en_zone: "4" };
// Eight names, of which the unit uses the first four.
const ZONE_SETTING = {
  ret: "OK",
  zone_name:
    "Living%20%20%3bKitchen%3bBed+1%3bBed%202%3bZone5%3bZone6%3bZone7%3bZone8",
  zone_onoff: "1%3b0%3b1%3b0%3b0%3b0%3b0%3b0",
};

describe("parseAirbaseZones", () => {
  it("reads the first en_zone zones, each without the spaces around its name", () => {
    expect(parseAirbaseZones(ZONE_SETTING, FOUR_ZONES)).toEqual([
      { name: "Living", enabled: true },
      { name: "Kitchen", enabled: false },
      { name: "Bed 1", enabled: true },
      { name: "Bed 2", enabled: false },
    ]);
  });

  it("reads lists that are joined by a plain ;", () => {
    expect(
      parseAirbaseZones(
        { zone_name: "A;B", zone_onoff: "0;1" },
        { en_zone: "2" },
      ),
    ).toEqual([
      { name: "A", enabled: false },
      { name: "B", enabled: true },
    ]);
  });

  it("reads no zones on a unit without en_zone, or from a reply without names", () => {
    expect(parseAirbaseZones(ZONE_SETTING, {})).toEqual([]);
    expect(parseAirbaseZones(ZONE_SETTING, { en_zone: "0" })).toEqual([]);
    expect(parseAirbaseZones({ ret: "OK" }, FOUR_ZONES)).toEqual([]);
  });

  it("reads no more zones than the reply names", () => {
    expect(
      parseAirbaseZones({ zone_name: "A;B", zone_onoff: "1;1" }, FOUR_ZONES),
    ).toHaveLength(2);
  });
});

describe("applyAirbaseZone", () => {
  // A unit that sets a temperature for each zone, and what it answers.
  const LINEAR_ZONES = { ...FOUR_ZONES, en_linear_zone: "1" };
  const WITH_TEMPERATURES = {
    ...ZONE_SETTING,
    lztemp_c: "24%3b25%3b24%3b24%3b0%3b0%3b0%3b0",
    lztemp_h: "20%3b21%3b20%3b20%3b0%3b0%3b0%3b0",
  };
  const COOL = "24;25;24;24;0;0;0;0";
  const HEAT = "20;21;20;20;0;0;0;0";

  it("sets one zone, and sends every name and every other zone back as held", () => {
    expect(applyAirbaseZone(ZONE_SETTING, FOUR_ZONES, {}, 1, true)).toEqual({
      zone_name: "Living  ;Kitchen;Bed 1;Bed 2;Zone5;Zone6;Zone7;Zone8",
      zone_onoff: "1;1;1;0;0;0;0;0",
    });
    expect(
      applyAirbaseZone(ZONE_SETTING, FOUR_ZONES, {}, 0, false).zone_onoff,
    ).toBe("0;0;1;0;0;0;0;0");
  });

  it.each([
    ["cool", { mode: "2" }, { lztemp_c: COOL }],
    ["heat", { mode: "1" }, { lztemp_h: HEAT }],
    ["auto on cool", { mode: "3", bk_auto: "2" }, { lztemp_c: COOL }],
    ["auto on heat", { mode: "3", bk_auto: "1" }, { lztemp_h: HEAT }],
    ["auto without bk_auto", { mode: "3" }, { lztemp_c: COOL }],
    ["fan", { mode: "0" }, {}],
    ["dehumidify", { mode: "7" }, {}],
  ])(
    "sends the zone temperatures of a unit in %s that sets one for each zone",
    (_mode, controlInfo, temperatures) => {
      expect(
        applyAirbaseZone(WITH_TEMPERATURES, LINEAR_ZONES, controlInfo, 3, true),
      ).toEqual({
        zone_name: "Living  ;Kitchen;Bed 1;Bed 2;Zone5;Zone6;Zone7;Zone8",
        zone_onoff: "1;0;1;1;0;0;0;0",
        ...temperatures,
      });
    },
  );

  it("sends no zone temperature for a unit that reports no en_linear_zone=1", () => {
    expect(
      applyAirbaseZone(WITH_TEMPERATURES, FOUR_ZONES, { mode: "2" }, 3, true),
    ).not.toHaveProperty("lztemp_c");
  });

  it("sends no zone temperature the reply lacks", () => {
    expect(
      applyAirbaseZone(ZONE_SETTING, LINEAR_ZONES, { mode: "2" }, 3, true),
    ).not.toHaveProperty("lztemp_c");
  });

  it("throws for an index the unit has no zone at", () => {
    for (const index of [4, -1, 1.5]) {
      expect(() =>
        applyAirbaseZone(ZONE_SETTING, FOUR_ZONES, {}, index, true),
      ).toThrow(`The unit has no zone ${index}: it has 4`);
    }
    expect(() => applyAirbaseZone(ZONE_SETTING, {}, {}, 0, true)).toThrow(
      "The unit has no zone 0: it has 0",
    );
  });
});
