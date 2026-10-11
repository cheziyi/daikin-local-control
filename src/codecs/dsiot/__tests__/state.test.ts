import { describe, expect, it } from "vitest";
import type { TargetHumidity } from "../../../models/state.js";
import {
  applyDsiotControl,
  DSIOT_PATHS,
  decodeDsiotBoolean,
  decodeDsiotFanSpeed,
  decodeDsiotIndoorHumidity,
  decodeDsiotIndoorTemperature,
  decodeDsiotLittleEndian,
  decodeDsiotMode,
  decodeDsiotOutdoorTemperature,
  decodeDsiotSetpoint,
  encodeDsiotBoolean,
  encodeDsiotFanSpeed,
  encodeDsiotMode,
  encodeDsiotSetpoint,
  isDsiotLouverSwinging,
  parseDsiotSensors,
  parseDsiotState,
} from "../state.js";
import {
  INDOOR_STATUS,
  louverMask,
  modeLeaf,
} from "./fixtures/indoorStatus.js";

// The leaves this file reads and writes, by mode.
const COOL = {
  setpoint: modeLeaf("p_02"),
  humidity: modeLeaf("p_0B"),
  humidityFlag: modeLeaf("p_0C"),
  fanSpeed: modeLeaf("p_09"),
  vertical: modeLeaf("p_05"),
  horizontal: modeLeaf("p_06"),
};
const HEAT = {
  setpoint: modeLeaf("p_03"),
  humidity: modeLeaf("p_2C"),
  humidityFlag: modeLeaf("p_2D"),
  fanSpeed: modeLeaf("p_0A"),
  vertical: modeLeaf("p_07"),
  horizontal: modeLeaf("p_08"),
};
const AUTO = { setpoint: modeLeaf("p_1D") };
const DEHUMIDIFY = { setpoint: modeLeaf("p_1E"), fanSpeed: modeLeaf("p_27") };
const FAN = { fanSpeed: modeLeaf("p_28") };

function leaves(
  updates: { path: string; value: string }[],
): Record<string, string> {
  return Object.fromEntries(updates.map(({ path, value }) => [path, value]));
}

describe("DSIOT value encodings", () => {
  it("writes a boolean as 01 or 00, and reads any non-zero value as true", () => {
    expect(encodeDsiotBoolean(true)).toBe("01");
    expect(encodeDsiotBoolean(false)).toBe("00");
    expect(decodeDsiotBoolean("01")).toBe(true);
    expect(decodeDsiotBoolean("00")).toBe(false);
    expect(decodeDsiotBoolean(undefined)).toBe(false);
  });

  it("reads a multi-byte value little-endian", () => {
    expect(decodeDsiotLittleEndian("3000")).toBe(0x30);
    expect(decodeDsiotLittleEndian("0001")).toBe(0x100);
    expect(decodeDsiotLittleEndian("0F0000")).toBe(15);
  });

  it("writes a setpoint as one byte of half degrees", () => {
    expect(encodeDsiotSetpoint(24)).toBe("30");
    expect(encodeDsiotSetpoint(24.5)).toBe("31");
  });

  it("writes a setpoint in lower case, without padding", () => {
    expect(encodeDsiotSetpoint(22)).toBe("2c");
    expect(encodeDsiotSetpoint(5)).toBe("a");
  });

  it("reads a setpoint in half degrees, little-endian or as a signed byte", () => {
    expect(decodeDsiotSetpoint("3000", false)).toBe(24);
    expect(decodeDsiotSetpoint("30", false)).toBe(24);
    expect(decodeDsiotSetpoint("31", true)).toBe(24.5);
    expect(decodeDsiotSetpoint("F6", true)).toBe(-5);
  });

  it("reads a missing or empty setpoint as null", () => {
    expect(decodeDsiotSetpoint(undefined, false)).toBeNull();
    expect(decodeDsiotSetpoint("", true)).toBeNull();
  });

  it("reads the indoor temperature as a signed byte of whole °C", () => {
    expect(decodeDsiotIndoorTemperature("1A")).toBe(26);
    expect(decodeDsiotIndoorTemperature("FB")).toBe(-5);
    expect(decodeDsiotIndoorTemperature(undefined)).toBeNull();
  });

  it("reads the indoor humidity as an unsigned byte of %", () => {
    expect(decodeDsiotIndoorHumidity("37")).toBe(55);
    expect(decodeDsiotIndoorHumidity(undefined)).toBeNull();
  });

  it("reads the outdoor temperature as signed little-endian half degrees", () => {
    expect(decodeDsiotOutdoorTemperature("3D00")).toBe(30.5);
    expect(decodeDsiotOutdoorTemperature("F6FF")).toBe(-5);
    expect(decodeDsiotOutdoorTemperature(undefined)).toBeNull();
  });

  it("reads an outdoor temperature that is not hex as null", () => {
    expect(decodeDsiotOutdoorTemperature("ZZZZ")).toBeNull();
    expect(decodeDsiotOutdoorTemperature("0000")).toBe(0);
  });

  it.each([
    ["fan", "0000"],
    ["heat", "0100"],
    ["cool", "0200"],
    ["auto", "0300"],
    ["dehumidify", "0500"],
  ] as const)("holds the %s mode as %s", (mode, pv) => {
    expect(encodeDsiotMode(mode)).toBe(pv);
    expect(decodeDsiotMode(pv)).toBe(mode);
  });

  it("reads 0900 as cool and 0A00 as heat, in either case", () => {
    expect(decodeDsiotMode("0900")).toBe("cool");
    expect(decodeDsiotMode("0A00")).toBe("heat");
    expect(decodeDsiotMode("0a00")).toBe("heat");
  });

  it("reads a mode outside the model as undefined", () => {
    expect(decodeDsiotMode("0800")).toBeUndefined();
    expect(decodeDsiotMode(undefined)).toBeUndefined();
  });

  it.each([
    ["auto", "0A00"],
    ["silent", "0B00"],
    ["level1", "0300"],
    ["level2", "0400"],
    ["level3", "0500"],
    ["level4", "0600"],
    ["level5", "0700"],
  ] as const)("holds the %s fan speed as %s", (fanSpeed, pv) => {
    expect(encodeDsiotFanSpeed(fanSpeed)).toBe(pv);
    expect(decodeDsiotFanSpeed(pv)).toBe(fanSpeed);
    expect(decodeDsiotFanSpeed(pv.toLowerCase())).toBe(fanSpeed);
  });

  it("reads a fan speed outside the model as undefined", () => {
    expect(decodeDsiotFanSpeed("0C00")).toBeUndefined();
    expect(decodeDsiotFanSpeed(undefined)).toBeUndefined();
  });

  it("tells a swinging louver by 0F0000, in either case", () => {
    expect(isDsiotLouverSwinging("0F0000")).toBe(true);
    expect(isDsiotLouverSwinging("0f0000")).toBe(true);
    expect(isDsiotLouverSwinging("000000")).toBe(false);
    expect(isDsiotLouverSwinging(undefined)).toBe(false);
  });
});

describe("parseDsiotState", () => {
  it("reads the indoor status", () => {
    expect(parseDsiotState(INDOOR_STATUS)).toEqual({
      power: false,
      mode: "cool",
      targetTemperatureInC: 24,
      targetHumidity: null,
      fanSpeed: "auto",
      swingMode: "vertical",
      verticalPosition: "swing",
      horizontalPosition: "stop",
    });
  });

  it("reads each value from the current mode's own leaves", () => {
    expect(
      parseDsiotState({
        ...INDOOR_STATUS,
        [DSIOT_PATHS.power]: "01",
        [DSIOT_PATHS.mode]: "0100",
        [HEAT.setpoint]: "2C00",
        [HEAT.fanSpeed]: "0500",
        [HEAT.vertical]: "000000",
        [HEAT.horizontal]: "0F0000",
      }),
    ).toEqual({
      power: true,
      mode: "heat",
      targetTemperatureInC: 22,
      targetHumidity: null,
      fanSpeed: "level3",
      swingMode: "horizontal",
      verticalPosition: "stop",
      horizontalPosition: "swing",
    });
  });

  it("reads the auto and dehumidify setpoints as signed bytes", () => {
    expect(
      parseDsiotState({ [DSIOT_PATHS.mode]: "0300", [AUTO.setpoint]: "F6" })
        .targetTemperatureInC,
    ).toBe(-5);
    expect(
      parseDsiotState({
        [DSIOT_PATHS.mode]: "0500",
        [DEHUMIDIFY.setpoint]: "30",
      }).targetTemperatureInC,
    ).toBe(24);
  });

  it("reads no setpoint and no humidity in fan mode", () => {
    expect(
      parseDsiotState({
        ...INDOOR_STATUS,
        [DSIOT_PATHS.mode]: "0000",
        [FAN.fanSpeed]: "0700",
      }),
    ).toMatchObject({
      mode: "fan",
      targetTemperatureInC: null,
      targetHumidity: null,
      fanSpeed: "level5",
    });
  });

  it("reads a mode outside the model, or a missing one, as auto", () => {
    expect(parseDsiotState({ [DSIOT_PATHS.mode]: "0800" }).mode).toBe("auto");
    expect(parseDsiotState({}).mode).toBe("auto");
  });

  it("reads a fan speed outside the model, or a missing one, as auto", () => {
    expect(
      parseDsiotState({ ...INDOOR_STATUS, [COOL.fanSpeed]: "0C00" }).fanSpeed,
    ).toBe("auto");
    expect(parseDsiotState({ [DSIOT_PATHS.mode]: "0200" }).fanSpeed).toBe(
      "auto",
    );
  });

  it.each([
    ["000000", "000000", "off"],
    ["0F0000", "000000", "vertical"],
    ["000000", "0F0000", "horizontal"],
    ["0F0000", "0F0000", "both"],
  ])(
    "reads vertical %s with horizontal %s as the %s swing mode",
    (vertical, horizontal, expected) => {
      expect(
        parseDsiotState({
          ...INDOOR_STATUS,
          [COOL.vertical]: vertical,
          [COOL.horizontal]: horizontal,
        }).swingMode,
      ).toBe(expected);
    },
  );

  describe("targetHumidity", () => {
    function humidity(values: Record<string, string>): TargetHumidity | null {
      return parseDsiotState({ ...INDOOR_STATUS, ...values }).targetHumidity;
    }

    it("counts the value in steps of md.st when the flag is 01", () => {
      expect(
        humidity({
          [COOL.humidity]: "0A",
          [`${COOL.humidity}.md.st`]: "5",
          [COOL.humidityFlag]: "01",
        }),
      ).toEqual({ percent: 50 });
    });

    it("takes the value as it is without a step, or with a step of zero", () => {
      expect(
        humidity({ [COOL.humidity]: "32", [COOL.humidityFlag]: "01" }),
      ).toEqual({ percent: 50 });
      expect(
        humidity({
          [COOL.humidity]: "32",
          [`${COOL.humidity}.md.st`]: "0",
          [COOL.humidityFlag]: "01",
        }),
      ).toEqual({ percent: 50 });
    });

    it("scales the step by the power of ten in its high nibble", () => {
      // 0x11: a count of 1, times ten to the power 1.
      expect(
        humidity({
          [COOL.humidity]: "05",
          [`${COOL.humidity}.md.st`]: "17",
          [COOL.humidityFlag]: "01",
        }),
      ).toEqual({ percent: 50 });
      // 0xF5: a count of 5, times ten to the power -1.
      expect(
        humidity({
          [COOL.humidity]: "64",
          [`${COOL.humidity}.md.st`]: "245",
          [COOL.humidityFlag]: "01",
        }),
      ).toEqual({ percent: 50 });
    });

    it.each(["00", "05"])("reads the flag %s as off", (flag) => {
      expect(
        humidity({ [COOL.humidity]: "0A", [COOL.humidityFlag]: flag }),
      ).toBe("off");
    });

    it.each([
      ["02", "auto"],
      ["03", "autoHigh"],
      ["04", "autoLow"],
      ["06", "continuous"],
    ])("reads the flag %s as %s", (flag, expected) => {
      expect(
        humidity({ [COOL.humidity]: "0A", [COOL.humidityFlag]: flag }),
      ).toBe(expected);
    });

    it("reads any other flag, or none, as null", () => {
      expect(
        humidity({ [COOL.humidity]: "0A", [COOL.humidityFlag]: "07" }),
      ).toBeNull();
      expect(humidity({ [COOL.humidity]: "0A" })).toBeNull();
    });

    it("reads a flag of 01 without a value as null", () => {
      expect(humidity({ [COOL.humidityFlag]: "01" })).toBeNull();
    });
  });

  describe("verticalPosition", () => {
    function vertical(pv: string, mask?: string): string | null {
      return parseDsiotState({
        ...INDOOR_STATUS,
        [COOL.vertical]: pv,
        ...(mask === undefined ? {} : { [`${COOL.vertical}.md.mx`]: mask }),
      }).verticalPosition;
    }

    it.each([
      ["000000", "stop"],
      ["0F0000", "swing"],
      ["100000", "auto"],
      ["130000", "naturalWind"],
      ["190000", "floorWarming"],
    ])("reads %s as %s", (pv, expected) => {
      expect(vertical(pv)).toBe(expected);
    });

    it("names a fixed position by its rank among those md.mx allows", () => {
      const mask = louverMask(0, 2, 4, 6, 15, 25);

      expect(vertical("020000", mask)).toBe("position1");
      expect(vertical("040000", mask)).toBe("position2");
      expect(vertical("060000", mask)).toBe("position3");
    });

    it("reads a fixed position md.mx does not allow as stop", () => {
      expect(vertical("030000", louverMask(0, 2, 4, 6, 15))).toBe("stop");
      expect(vertical("040000")).toBe("stop");
    });

    it("reads a sixth fixed position as null", () => {
      expect(vertical("060000", louverMask(1, 2, 3, 4, 5, 6))).toBeNull();
    });

    it("reads any other value as null", () => {
      expect(vertical("110000")).toBeNull();
    });

    it("reads a missing leaf as null", () => {
      expect(
        parseDsiotState({ [DSIOT_PATHS.mode]: "0200" }).verticalPosition,
      ).toBeNull();
    });
  });

  describe("horizontalPosition", () => {
    function horizontal(pv: string): string | null {
      return parseDsiotState({ ...INDOOR_STATUS, [COOL.horizontal]: pv })
        .horizontalPosition;
    }

    it.each([
      ["000000", "stop"],
      ["0F0000", "swing"],
      ["100000", "auto"],
    ])("reads %s as %s", (pv, expected) => {
      expect(horizontal(pv)).toBe(expected);
    });

    it("reads a fixed position as stop", () => {
      expect(horizontal("030000")).toBe("stop");
      expect(horizontal("0E0000")).toBe("stop");
    });

    it("reads any other value as null", () => {
      expect(horizontal("130000")).toBeNull();
    });

    it("reads a missing leaf as null", () => {
      expect(
        parseDsiotState({ [DSIOT_PATHS.mode]: "0200" }).horizontalPosition,
      ).toBeNull();
    });
  });
});

describe("applyDsiotControl", () => {
  it("writes power, its transition and the mode for an empty control", () => {
    expect(applyDsiotControl(INDOOR_STATUS, {})).toEqual([
      { path: DSIOT_PATHS.power, value: "00" },
      { path: DSIOT_PATHS.powerTransition, value: "02" },
      { path: DSIOT_PATHS.mode, value: "0200" },
    ]);
  });

  it("writes power, its transition, the mode and the mode's changed leaves", () => {
    expect(
      leaves(
        applyDsiotControl(INDOOR_STATUS, {
          power: true,
          mode: "heat",
          targetTemperatureInC: 22,
          fanSpeed: "level3",
          swingMode: "off",
        }),
      ),
    ).toEqual({
      [DSIOT_PATHS.power]: "01",
      [DSIOT_PATHS.powerTransition]: "00",
      [DSIOT_PATHS.mode]: "0100",
      [HEAT.setpoint]: "2c",
      [HEAT.fanSpeed]: "0500",
      [HEAT.vertical]: "000000",
      [HEAT.horizontal]: "000000",
    });
  });

  describe("mode", () => {
    const humidifying = { ...INDOOR_STATUS, [DSIOT_PATHS.mode]: "0800" };

    it("writes a mode outside the model back as it came, with power alone", () => {
      expect(
        applyDsiotControl(humidifying, {
          power: true,
          targetTemperatureInC: 22,
          fanSpeed: "level3",
          swingMode: "both",
        }),
      ).toEqual([
        { path: DSIOT_PATHS.power, value: "01" },
        { path: DSIOT_PATHS.powerTransition, value: "00" },
        { path: DSIOT_PATHS.mode, value: "0800" },
      ]);
    });

    it("leaves a mode outside the model when the control sets one", () => {
      expect(
        leaves(
          applyDsiotControl(humidifying, { mode: "cool", fanSpeed: "level3" }),
        ),
      ).toMatchObject({
        [DSIOT_PATHS.mode]: "0200",
        [COOL.fanSpeed]: "0500",
      });
    });

    it("writes auto when the unit reports no mode", () => {
      expect(leaves(applyDsiotControl({}, {}))).toMatchObject({
        [DSIOT_PATHS.mode]: "0300",
      });
    });
  });

  describe("power transition", () => {
    const running = { ...INDOOR_STATUS, [DSIOT_PATHS.power]: "01" };

    it.each([
      ["turning on", INDOOR_STATUS, true, "01", "00"],
      ["turning off", running, false, "00", "01"],
      ["staying on", running, true, "01", "02"],
      ["staying off", INDOOR_STATUS, false, "00", "02"],
    ])(
      "writes the transition for %s",
      (_case, values, power, pv, transition) => {
        expect(leaves(applyDsiotControl(values, { power }))).toMatchObject({
          [DSIOT_PATHS.power]: pv,
          [DSIOT_PATHS.powerTransition]: transition,
        });
      },
    );
  });

  describe("targetTemperatureInC", () => {
    it("writes the current mode's setpoint", () => {
      expect(
        leaves(
          applyDsiotControl(INDOOR_STATUS, { targetTemperatureInC: 24.5 }),
        ),
      ).toMatchObject({ [COOL.setpoint]: "31" });
    });

    it("is dropped in dehumidify, whose setpoint is read-only", () => {
      expect(
        leaves(
          applyDsiotControl(INDOOR_STATUS, {
            mode: "dehumidify",
            targetTemperatureInC: 22,
          }),
        ),
      ).not.toHaveProperty([DEHUMIDIFY.setpoint]);
    });

    it("is dropped in fan mode, which has no setpoint", () => {
      expect(
        applyDsiotControl(INDOOR_STATUS, {
          mode: "fan",
          targetTemperatureInC: 22,
        }),
      ).toEqual([
        { path: DSIOT_PATHS.power, value: "00" },
        { path: DSIOT_PATHS.powerTransition, value: "02" },
        { path: DSIOT_PATHS.mode, value: "0000" },
      ]);
    });
  });

  describe("targetHumidity", () => {
    // Cool holds 50 % in steps of 5; heat holds the off flag that is kept; auto
    // has no humidity leaves.
    const humid = {
      ...INDOOR_STATUS,
      [COOL.humidity]: "0A",
      [`${COOL.humidity}.md.st`]: "5",
      [COOL.humidityFlag]: "01",
      [HEAT.humidityFlag]: "05",
    };

    it("writes the count of md.st steps, and the flag 01", () => {
      const written = leaves(
        applyDsiotControl(humid, { targetHumidity: { percent: 60 } }),
      );

      expect(written).toMatchObject({
        [COOL.humidity]: "0C",
        [COOL.humidityFlag]: "01",
      });
    });

    it("writes the percentage as it is when the leaf has no step", () => {
      const written = leaves(
        applyDsiotControl(humid, {
          mode: "heat",
          targetHumidity: { percent: 60 },
        }),
      );

      expect(written).toMatchObject({
        [HEAT.humidity]: "3C",
        [HEAT.humidityFlag]: "01",
      });
    });

    it.each([
      ["auto", "02"],
      ["autoHigh", "03"],
      ["autoLow", "04"],
      ["continuous", "06"],
    ] as const)("writes %s as the flag %s alone", (targetHumidity, flag) => {
      const written = leaves(applyDsiotControl(humid, { targetHumidity }));

      expect(written).toMatchObject({ [COOL.humidityFlag]: flag });
      expect(written).not.toHaveProperty([COOL.humidity]);
    });

    it("writes the flag 00 alone to switch it off", () => {
      const written = leaves(
        applyDsiotControl(humid, { targetHumidity: "off" }),
      );

      expect(written).toMatchObject({ [COOL.humidityFlag]: "00" });
      expect(written).not.toHaveProperty([COOL.humidity]);
    });

    it("keeps a flag of 05 when switching it off", () => {
      const written = leaves(
        applyDsiotControl(humid, { mode: "heat", targetHumidity: "off" }),
      );

      expect(written).toMatchObject({ [HEAT.humidityFlag]: "05" });
    });

    it("is dropped in a mode the unit has no humidity leaves for", () => {
      expect(
        applyDsiotControl(humid, {
          mode: "auto",
          targetHumidity: { percent: 60 },
        }),
      ).toEqual([
        { path: DSIOT_PATHS.power, value: "00" },
        { path: DSIOT_PATHS.powerTransition, value: "02" },
        { path: DSIOT_PATHS.mode, value: "0300" },
      ]);
    });
  });

  describe("fanSpeed", () => {
    it("writes the current mode's fan speed", () => {
      expect(
        leaves(applyDsiotControl(INDOOR_STATUS, { fanSpeed: "silent" })),
      ).toMatchObject({ [COOL.fanSpeed]: "0B00" });
    });

    it("is always auto in dehumidify, whatever the control asks for", () => {
      expect(
        leaves(
          applyDsiotControl(INDOOR_STATUS, {
            mode: "dehumidify",
            fanSpeed: "level3",
          }),
        ),
      ).toMatchObject({ [DEHUMIDIFY.fanSpeed]: "0A00" });
      expect(
        leaves(applyDsiotControl(INDOOR_STATUS, { mode: "dehumidify" })),
      ).toMatchObject({ [DEHUMIDIFY.fanSpeed]: "0A00" });
    });
  });

  describe("fanSpeed in cool with humidity leaves", () => {
    const humid = { ...INDOOR_STATUS, [COOL.humidityFlag]: "01" };

    it("is always auto while a humidity setting is on", () => {
      expect(
        leaves(applyDsiotControl(humid, { fanSpeed: "level3" })),
      ).toMatchObject({ [COOL.fanSpeed]: "0A00" });
      expect(leaves(applyDsiotControl(humid, {}))).toMatchObject({
        [COOL.fanSpeed]: "0A00",
      });
    });

    it("is always auto when the control switches a humidity setting on", () => {
      expect(
        leaves(
          applyDsiotControl(
            { ...humid, [COOL.humidityFlag]: "00" },
            { targetHumidity: "auto", fanSpeed: "level3" },
          ),
        ),
      ).toMatchObject({ [COOL.fanSpeed]: "0A00" });
    });

    it("is written as asked when the control switches humidity off", () => {
      expect(
        leaves(
          applyDsiotControl(humid, {
            targetHumidity: "off",
            fanSpeed: "level3",
          }),
        ),
      ).toMatchObject({ [COOL.fanSpeed]: "0500" });
    });

    it.each(["00", "05"])(
      "is written as asked while the flag is %s",
      (flag) => {
        const written = leaves(
          applyDsiotControl({ ...humid, [COOL.humidityFlag]: flag }, {}),
        );

        expect(written).not.toHaveProperty([COOL.fanSpeed]);
        expect(
          leaves(
            applyDsiotControl(
              { ...humid, [COOL.humidityFlag]: flag },
              { fanSpeed: "level3" },
            ),
          ),
        ).toMatchObject({ [COOL.fanSpeed]: "0500" });
      },
    );

    it("is written as asked in another mode", () => {
      expect(
        leaves(
          applyDsiotControl(
            { ...humid, [HEAT.humidityFlag]: "01" },
            { mode: "heat", fanSpeed: "level3" },
          ),
        ),
      ).toMatchObject({ [HEAT.fanSpeed]: "0500" });
    });
  });

  describe("swingMode", () => {
    it.each([
      ["off", "000000", "000000"],
      ["vertical", "0F0000", "000000"],
      ["horizontal", "000000", "0F0000"],
      ["both", "0F0000", "0F0000"],
    ] as const)(
      "writes %s as vertical %s and horizontal %s",
      (swingMode, vertical, horizontal) => {
        expect(
          leaves(applyDsiotControl(INDOOR_STATUS, { swingMode })),
        ).toMatchObject({
          [COOL.vertical]: vertical,
          [COOL.horizontal]: horizontal,
        });
      },
    );

    it("keeps a fixed position on an axis it leaves off", () => {
      expect(
        leaves(
          applyDsiotControl(
            { ...INDOOR_STATUS, [COOL.horizontal]: "030000" },
            { swingMode: "vertical" },
          ),
        ),
      ).toMatchObject({
        [COOL.vertical]: "0F0000",
        [COOL.horizontal]: "030000",
      });
    });

    it("writes no louver leaf when the control sets no airflow", () => {
      const written = leaves(applyDsiotControl(INDOOR_STATUS, { power: true }));

      expect(written).not.toHaveProperty([COOL.vertical]);
      expect(written).not.toHaveProperty([COOL.horizontal]);
    });
  });

  describe("louver positions", () => {
    // The unit takes the fixed vertical values 2, 4 and 6, and holds the second
    // of them; its horizontal louver holds the fixed value 3.
    const louvered = {
      ...INDOOR_STATUS,
      [COOL.vertical]: "040000",
      [`${COOL.vertical}.md.mx`]: louverMask(0, 2, 4, 6, 15, 25),
      [COOL.horizontal]: "030000",
      [`${COOL.horizontal}.md.mx`]: louverMask(0, 3, 15),
    };

    it("writes a fixed vertical position as the value of that rank in md.mx", () => {
      expect(
        leaves(applyDsiotControl(louvered, { verticalPosition: "position3" })),
      ).toMatchObject({ [COOL.vertical]: "060000" });
    });

    it.each([
      ["stop", "000000"],
      ["swing", "0F0000"],
      ["auto", "100000"],
      ["naturalWind", "130000"],
      ["floorWarming", "190000"],
    ] as const)(
      "writes the %s vertical position as %s",
      (verticalPosition, pv) => {
        expect(
          leaves(applyDsiotControl(louvered, { verticalPosition })),
        ).toMatchObject({ [COOL.vertical]: pv });
      },
    );

    it("drops a fixed vertical position beyond those the unit takes", () => {
      expect(
        leaves(applyDsiotControl(louvered, { verticalPosition: "position4" })),
      ).not.toHaveProperty([COOL.vertical]);
    });

    it("drops a vertical position no adapter has", () => {
      expect(
        leaves(
          applyDsiotControl(louvered, {
            // @ts-expect-error No adapter has a sixth fixed position.
            verticalPosition: "position6",
          }),
        ),
      ).not.toHaveProperty([COOL.vertical]);
    });

    it.each([
      ["swing", "0F0000"],
      ["auto", "100000"],
    ] as const)(
      "writes the %s horizontal position as %s",
      (horizontalPosition, pv) => {
        expect(
          leaves(applyDsiotControl(louvered, { horizontalPosition })),
        ).toMatchObject({ [COOL.horizontal]: pv });
      },
    );

    it("keeps a fixed horizontal position when told to stop", () => {
      expect(
        leaves(applyDsiotControl(louvered, { horizontalPosition: "stop" })),
      ).toMatchObject({ [COOL.horizontal]: "030000" });
    });

    it("stops a swinging horizontal louver when told to stop", () => {
      expect(
        leaves(
          applyDsiotControl(
            { ...louvered, [COOL.horizontal]: "0F0000" },
            { horizontalPosition: "stop" },
          ),
        ),
      ).toMatchObject({ [COOL.horizontal]: "000000" });
    });

    it("drops a fixed horizontal position", () => {
      expect(
        leaves(
          applyDsiotControl(louvered, { horizontalPosition: "position2" }),
        ),
      ).not.toHaveProperty([COOL.horizontal]);
    });

    it("writes a position over the swing mode sent with it", () => {
      expect(
        leaves(
          applyDsiotControl(louvered, {
            swingMode: "both",
            verticalPosition: "position1",
          }),
        ),
      ).toMatchObject({
        [COOL.vertical]: "020000",
        [COOL.horizontal]: "0F0000",
      });
    });

    it("writes the swing mode's value for a position the unit does not take", () => {
      expect(
        leaves(
          applyDsiotControl(louvered, {
            swingMode: "vertical",
            verticalPosition: "position4",
          }),
        ),
      ).toMatchObject({ [COOL.vertical]: "0F0000" });
    });
  });
});

describe("parseDsiotSensors", () => {
  it("reads the indoor readings and the outdoor temperature", () => {
    expect(
      parseDsiotSensors({
        ...INDOOR_STATUS,
        [DSIOT_PATHS.outdoorTemperature]: "3D00",
      }),
    ).toEqual({
      indoorTemperatureInC: 26,
      indoorHumidityInPercent: 55,
      outdoorTemperatureInC: 30.5,
    });
  });

  it("reads a reading the unit does not report as null", () => {
    expect(parseDsiotSensors({})).toEqual({
      indoorTemperatureInC: null,
      indoorHumidityInPercent: null,
      outdoorTemperatureInC: null,
    });
  });
});
