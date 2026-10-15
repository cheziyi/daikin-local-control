import { describe, expect, it } from "vitest";
import {
  mergeClassicCapabilityFields,
  parseClassicCapabilities,
  takesClassicDirection,
} from "../capabilities.js";

const BASE = { cpv: "3", reg: "sg" };

describe("mergeClassicCapabilityFields", () => {
  it("renames each reply's type before merging", () => {
    expect(
      mergeClassicCapabilityFields(
        { ret: "OK", type: "aircon", reg: "sg" },
        { ret: "OK", type: "C", cpv: "3" },
      ),
    ).toEqual({
      ret: "OK",
      reg: "sg",
      cpv: "3",
      basic_type: "aircon",
      model_type: "C",
    });
  });

  it("leaves out the type of a reply that has none", () => {
    expect(mergeClassicCapabilityFields({ reg: "sg" }, { cpv: "3" })).toEqual({
      reg: "sg",
      cpv: "3",
    });
  });

  it("takes a field both replies carry from get_model_info", () => {
    expect(
      mergeClassicCapabilityFields({ en_frate: "0" }, { en_frate: "1" }),
    ).toEqual({ en_frate: "1" });
  });
});

describe("parseClassicCapabilities", () => {
  describe("modes", () => {
    it("offers every mode", () => {
      expect(parseClassicCapabilities(BASE).modes).toEqual([
        "auto",
        "dehumidify",
        "cool",
        "heat",
        "fan",
      ]);
    });

    it("offers dehumidify, cool and fan on a cooling-only unit", () => {
      const coolingOnly = parseClassicCapabilities(
        mergeClassicCapabilityFields(
          { type: "aircon" },
          { ...BASE, type: "C" },
        ),
      );

      expect(coolingOnly.modes).toEqual(["dehumidify", "cool", "fan"]);
    });

    it("offers none without a cpv it knows", () => {
      expect(parseClassicCapabilities({ reg: "sg" }).modes).toEqual([]);
      expect(parseClassicCapabilities({ ...BASE, cpv: "4" }).modes).toEqual([]);
    });
  });

  describe("targetTemperaturesInC", () => {
    it("reads setpoint limits as whole °C", () => {
      const { targetTemperaturesInC } = parseClassicCapabilities({
        ...BASE,
        cmlmt_l: "18",
        cmlmt_h: "32",
        hmlmt_l: "10.5",
        hmlmt_h: "30",
      });

      expect(targetTemperaturesInC.cool).toEqual({ min: 18, max: 32, step: 1 });
      expect(targetTemperaturesInC.heat).toEqual({ min: 10, max: 30, step: 1 });
    });

    it("offers 18 to 32 °C in cool and 10 to 30 °C in heat when the unit reports no limits", () => {
      const { targetTemperaturesInC } = parseClassicCapabilities(BASE);

      expect(targetTemperaturesInC.cool).toEqual({ min: 18, max: 32, step: 1 });
      expect(targetTemperaturesInC.heat).toEqual({ min: 10, max: 30, step: 1 });
    });

    it("offers 18 to 30 °C in auto, whatever limits the unit reports", () => {
      const { targetTemperaturesInC } = parseClassicCapabilities({
        ...BASE,
        cmlmt_l: "20",
        cmlmt_h: "28",
        hmlmt_l: "12",
        hmlmt_h: "26",
      });

      expect(targetTemperaturesInC.auto).toEqual({ min: 18, max: 30, step: 1 });
    });

    it("takes the auto range of a subtype=qa unit from hmlmt_l and cmlmt_h", () => {
      const { targetTemperaturesInC } = parseClassicCapabilities({
        ...BASE,
        subtype: "qa",
        cmlmt_l: "20",
        cmlmt_h: "28",
        hmlmt_l: "12",
        hmlmt_h: "26",
      });

      expect(targetTemperaturesInC.auto).toEqual({ min: 12, max: 28, step: 1 });
    });

    it("gives a setpoint range only to cool, heat and auto", () => {
      const { targetTemperaturesInC } = parseClassicCapabilities(BASE);

      expect(targetTemperaturesInC.fan).toBeNull();
      expect(targetTemperaturesInC.dehumidify).toBeNull();
    });

    it("gives no range to a mode the unit does not offer", () => {
      const { targetTemperaturesInC } = parseClassicCapabilities({
        ...BASE,
        model_type: "C",
      });

      expect(targetTemperaturesInC.heat).toBeNull();
      expect(targetTemperaturesInC.auto).toBeNull();
      expect(targetTemperaturesInC.cool).toEqual({ min: 18, max: 32, step: 1 });
    });
  });

  describe("fanSpeeds", () => {
    const fan = { ...BASE, en_frate: "1" };

    it("offers auto, silent and every level unless a field narrows them", () => {
      expect(parseClassicCapabilities(fan).fanSpeeds).toEqual([
        "auto",
        "silent",
        "level1",
        "level2",
        "level3",
        "level4",
        "level5",
      ]);
    });

    it("leaves out auto and silent when en_frate_auto and en_frate_silent are 0", () => {
      expect(
        parseClassicCapabilities({
          ...fan,
          en_frate_auto: "0",
          en_frate_silent: "0",
        }).fanSpeeds,
      ).toEqual(["level1", "level2", "level3", "level4", "level5"]);
    });

    it.each([
      ["2", ["level1", "level5"]],
      ["3", ["level1", "level3", "level5"]],
      ["5", ["level1", "level2", "level3", "level4", "level5"]],
    ])("offers the levels of frate_steps=%s", (frate_steps, levels) => {
      expect(
        parseClassicCapabilities({ ...fan, frate_steps }).fanSpeeds,
      ).toEqual(["auto", "silent", ...levels]);
    });

    it("offers no level for a frate_steps it does not know", () => {
      expect(
        parseClassicCapabilities({ ...fan, frate_steps: "4" }).fanSpeeds,
      ).toEqual(["auto", "silent"]);
    });

    it("offers silent only from cpv 2", () => {
      expect(
        parseClassicCapabilities({ ...fan, cpv: "1" }).fanSpeeds,
      ).not.toContain("silent");
      expect(
        parseClassicCapabilities({ ...fan, cpv: "2" }).fanSpeeds,
      ).toContain("silent");
    });

    it("offers none unless en_frate is 1", () => {
      expect(parseClassicCapabilities(BASE).fanSpeeds).toEqual([]);
    });

    it("offers none without a region, or for reg=jp", () => {
      expect(
        parseClassicCapabilities({ cpv: "3", en_frate: "1" }).fanSpeeds,
      ).toEqual([]);
      expect(parseClassicCapabilities({ ...fan, reg: "jp" }).fanSpeeds).toEqual(
        [],
      );
    });

    it("lists a reg=th subtype=qa unit's speeds without en_frate", () => {
      expect(
        parseClassicCapabilities({
          ...BASE,
          reg: "th",
          subtype: "qa",
          frate_steps: "2",
        }).fanSpeeds,
      ).toEqual(["auto", "silent", "level1", "level5"]);
    });
  });

  describe("swingModes", () => {
    it("offers both axes when en_fdir is 1, or vertical alone when s_fdir is 1", () => {
      expect(
        parseClassicCapabilities({ ...BASE, en_fdir: "1", s_fdir: "3" })
          .swingModes,
      ).toEqual(["off", "vertical", "horizontal", "3d"]);
      expect(
        parseClassicCapabilities({ ...BASE, en_fdir: "1", s_fdir: "1" })
          .swingModes,
      ).toEqual(["off", "vertical"]);
    });

    it("offers none unless en_fdir is 1", () => {
      expect(
        parseClassicCapabilities({ ...BASE, s_fdir: "3" }).swingModes,
      ).toEqual([]);
    });

    it("offers none without a region", () => {
      expect(
        parseClassicCapabilities({ cpv: "3", en_fdir: "1", s_fdir: "3" })
          .swingModes,
      ).toEqual([]);
    });

    it.each(["0", "1"])("reads s_fdir alone at cpv %s", (cpv) => {
      const old = { reg: "sg", cpv };

      expect(
        parseClassicCapabilities({ ...old, s_fdir: "3" }).swingModes,
      ).toEqual(["off", "vertical", "horizontal", "3d"]);
      expect(
        parseClassicCapabilities({ ...old, s_fdir: "1" }).swingModes,
      ).toEqual(["off", "vertical"]);
      expect(
        parseClassicCapabilities({ ...old, en_fdir: "1", s_fdir: "0" })
          .swingModes,
      ).toEqual([]);
    });

    it("offers vertical alone to a subtype=qa unit, and only when s_fdir is 1", () => {
      const qa = { ...BASE, subtype: "qa", en_fdir: "1" };

      expect(
        parseClassicCapabilities({ ...qa, s_fdir: "1" }).swingModes,
      ).toEqual(["off", "vertical"]);
      expect(
        parseClassicCapabilities({ ...qa, s_fdir: "3" }).swingModes,
      ).toEqual([]);
    });

    it("offers both axes on a 3D unit that takes no f_dir", () => {
      expect(
        parseClassicCapabilities({ ...BASE, en_fdir2: "1" }).swingModes,
      ).toEqual(["off", "vertical", "horizontal", "3d"]);
    });
  });

  describe("verticalPositions", () => {
    const threeD = { ...BASE, en_fdir2: "1" };

    it("offers none unless the unit is 3D", () => {
      expect(
        parseClassicCapabilities({ ...BASE, s_fdir_ud: "91" })
          .verticalPositions,
      ).toEqual([]);
    });

    it("decodes the s_fdir_ud mask: swing, floor warming and the five fixed positions", () => {
      expect(
        parseClassicCapabilities({
          ...threeD,
          s_fdir_ud: "91",
          s_fdir_ud_step: "5",
        }).verticalPositions,
      ).toEqual([
        "swing",
        "floorWarming",
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
      ]);
    });

    it("offers the fixed positions only when s_fdir_ud_step is 5", () => {
      expect(
        parseClassicCapabilities({
          ...threeD,
          s_fdir_ud: "91",
          s_fdir_ud_step: "3",
        }).verticalPositions,
      ).toEqual(["swing", "floorWarming"]);
    });

    it("offers stop when the mask has nothing but swing", () => {
      expect(
        parseClassicCapabilities({ ...threeD, s_fdir_ud: "1" })
          .verticalPositions,
      ).toEqual(["swing", "stop"]);
      expect(
        parseClassicCapabilities({ ...threeD, s_fdir_ud: "0" })
          .verticalPositions,
      ).toEqual(["stop"]);
      expect(
        parseClassicCapabilities({ ...threeD, s_fdir_ud: "10" })
          .verticalPositions,
      ).toEqual(["floorWarming"]);
    });

    it.each([
      ["no s_fdir_ud", {}],
      ["an s_fdir_ud that is not hex", { s_fdir_ud: "zz" }],
      [
        "an s_fdir_ud_step outside 0 to 5",
        { s_fdir_ud: "91", s_fdir_ud_step: "9" },
      ],
      ["fixed positions without an s_fdir_ud_step", { s_fdir_ud: "91" }],
    ])("offers swing and stop for %s", (_case, fields) => {
      expect(
        parseClassicCapabilities({ ...threeD, ...fields }).verticalPositions,
      ).toEqual(["swing", "stop"]);
    });
  });

  describe("horizontalPositions", () => {
    const threeD = { ...BASE, en_fdir2: "1" };

    it("offers none unless the unit is 3D", () => {
      expect(
        parseClassicCapabilities({ ...BASE, s_fdir_lr: "1" })
          .horizontalPositions,
      ).toEqual([]);
    });

    it("offers stop, and swing when s_fdir_lr has its bit", () => {
      expect(
        parseClassicCapabilities({ ...threeD, s_fdir_lr: "1" })
          .horizontalPositions,
      ).toEqual(["stop", "swing"]);
      expect(
        parseClassicCapabilities({ ...threeD, s_fdir_lr: "0" })
          .horizontalPositions,
      ).toEqual(["stop"]);
      expect(parseClassicCapabilities(threeD).horizontalPositions).toEqual([
        "stop",
      ]);
    });
  });

  describe("targetHumidities", () => {
    const NONE = { auto: [], dehumidify: [], cool: [], heat: [], fan: [] };
    const SETTINGS = ["autoLow", "auto", "autoHigh", "continuous"];
    // Auto, cool, heat and dehumidify: bits 1, 2, 4 and 16.
    const EVERY_MODE = "23";

    it("reads s_humd as a decimal mask of the modes that take a setting", () => {
      expect(
        parseClassicCapabilities({ ...BASE, s_humd: EVERY_MODE })
          .targetHumidities,
      ).toEqual({
        auto: ["off", ...SETTINGS],
        dehumidify: SETTINGS,
        cool: ["off", ...SETTINGS],
        heat: ["off", ...SETTINGS],
        fan: [],
      });
      expect(
        parseClassicCapabilities({ ...BASE, s_humd: "2" }).targetHumidities,
      ).toEqual({ ...NONE, cool: ["off", ...SETTINGS] });
    });

    it("is offered in no mode without a bit in s_humd", () => {
      expect(
        parseClassicCapabilities({ ...BASE, s_humd: "0" }).targetHumidities,
      ).toEqual(NONE);
      expect(parseClassicCapabilities(BASE).targetHumidities).toEqual(NONE);
    });

    it("is offered only from cpv 2", () => {
      expect(
        parseClassicCapabilities({ ...BASE, cpv: "1", s_humd: EVERY_MODE })
          .targetHumidities,
      ).toEqual(NONE);
    });

    it("is offered in no mode of a subtype=qa unit", () => {
      expect(
        parseClassicCapabilities({
          ...BASE,
          subtype: "qa",
          s_humd: EVERY_MODE,
        }).targetHumidities,
      ).toEqual(NONE);
    });

    it("is offered only in a mode the unit offers", () => {
      expect(
        parseClassicCapabilities({
          ...BASE,
          model_type: "C",
          s_humd: EVERY_MODE,
        }).targetHumidities,
      ).toEqual({ ...NONE, dehumidify: SETTINGS, cool: ["off", ...SETTINGS] });
    });
  });

  describe("specialModes", () => {
    const MINOR = { ...BASE, cpv_minor: "20" };
    const NONE = { auto: [], dehumidify: [], cool: [], heat: [], fan: [] };

    it.each([
      ["1", ["powerful"]],
      ["2", ["econo"]],
      ["4", ["streamer"]],
      ["7", ["powerful", "econo", "streamer"]],
      ["8", []],
      ["0", []],
    ] as const)(
      "reads en_spmode=%s as %j in cool",
      (en_spmode, specialModes) => {
        expect(
          parseClassicCapabilities({ ...MINOR, en_spmode }).specialModes.cool,
        ).toEqual(specialModes);
      },
    );

    it("lists econo in every mode but fan", () => {
      expect(
        parseClassicCapabilities({ ...MINOR, en_spmode: "7" }).specialModes,
      ).toEqual({
        auto: ["powerful", "econo", "streamer"],
        dehumidify: ["powerful", "econo", "streamer"],
        cool: ["powerful", "econo", "streamer"],
        heat: ["powerful", "econo", "streamer"],
        fan: ["powerful", "streamer"],
      });
    });

    it.each([
      ["cpv_minor is 00", { ...BASE, cpv_minor: "00" }],
      ["there is no cpv_minor", BASE],
      ["cpv is 2", { ...MINOR, cpv: "2" }],
    ])("lists streamer alone when %s", (_case, fields) => {
      expect(
        parseClassicCapabilities({ ...fields, en_spmode: "7" }).specialModes
          .cool,
      ).toEqual(["streamer"]);
    });

    it("lists none in a mode the unit does not offer", () => {
      expect(
        parseClassicCapabilities({ ...MINOR, model_type: "C", en_spmode: "7" })
          .specialModes.heat,
      ).toEqual([]);
    });

    it("lists none for a unit that reports no en_spmode", () => {
      expect(parseClassicCapabilities(MINOR).specialModes).toEqual(NONE);
    });
  });

  describe("specialOutlet", () => {
    it("is set at cpv 3 when airoutlet_pv is 0", () => {
      expect(
        parseClassicCapabilities({ ...BASE, airoutlet_pv: "0" }).specialOutlet,
      ).toBe(true);
      expect(
        parseClassicCapabilities({ ...BASE, airoutlet_pv: "1" }).specialOutlet,
      ).toBe(false);
      expect(parseClassicCapabilities(BASE).specialOutlet).toBe(false);
      expect(
        parseClassicCapabilities({ ...BASE, cpv: "2", airoutlet_pv: "0" })
          .specialOutlet,
      ).toBe(false);
    });
  });

  describe("energyMonitoring", () => {
    it("is set when elec is 1", () => {
      expect(
        parseClassicCapabilities({ ...BASE, elec: "1" }).energyMonitoring,
      ).toBe(true);
      expect(parseClassicCapabilities(BASE).energyMonitoring).toBe(false);
    });
  });

  describe("demandControl", () => {
    it("is set when dmnd is 1 on an adp_kind=4 adapter", () => {
      expect(
        parseClassicCapabilities({ ...BASE, adp_kind: "4", dmnd: "1" })
          .demandControl,
      ).toBe(true);
      expect(
        parseClassicCapabilities({ ...BASE, adp_kind: "3", dmnd: "1" })
          .demandControl,
      ).toBe(false);
      expect(
        parseClassicCapabilities({ ...BASE, adp_kind: "4", dmnd: "0" })
          .demandControl,
      ).toBe(false);
    });
  });

  describe("scheduleTimer", () => {
    it.each([
      ["1", true],
      ["2", true],
      ["0", false],
    ])("reads en_scdltmr=%s as %s", (en_scdltmr, expected) => {
      expect(
        parseClassicCapabilities({ ...BASE, en_scdltmr }).scheduleTimer,
      ).toBe(expected);
    });

    it("is not set without en_scdltmr", () => {
      expect(parseClassicCapabilities(BASE).scheduleTimer).toBe(false);
    });
  });

  describe("model", () => {
    it("is the unit's model, or left out when the unit reports none", () => {
      expect(parseClassicCapabilities({ ...BASE, model: "0ABB" }).model).toBe(
        "0ABB",
      );
      expect(parseClassicCapabilities(BASE).model).toBeUndefined();
    });
  });
});

describe("takesClassicDirection", () => {
  it("is false on a unit without en_fdir", () => {
    expect(takesClassicDirection(BASE)).toBe(false);
    expect(takesClassicDirection({ ...BASE, en_fdir2: "1" })).toBe(false);
  });

  it("is true when en_fdir is 1", () => {
    expect(takesClassicDirection({ ...BASE, en_fdir: "1", s_fdir: "3" })).toBe(
      true,
    );
    expect(
      takesClassicDirection({ ...BASE, en_fdir: "1", en_fdir2: "1" }),
    ).toBe(true);
  });

  it("is false without a region", () => {
    expect(
      takesClassicDirection({ cpv: "3", en_fdir: "1", en_fdir2: "1" }),
    ).toBe(false);
  });
});
