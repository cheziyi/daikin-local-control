import { describe, expect, it } from "vitest";
import {
  applyClassicControl,
  parseClassicSensors,
  parseClassicState,
} from "../state.js";

describe("parseClassicState", () => {
  it("reads a get_control_info reply", () => {
    expect(
      parseClassicState({
        ret: "OK",
        pow: "1",
        mode: "3",
        stemp: "24.0",
        shum: "0",
        f_rate: "A",
        f_dir: "1",
      }),
    ).toEqual({
      power: true,
      mode: "cool",
      targetTemperatureInC: 24,
      targetHumidity: "off",
      fanSpeed: "auto",
      swingMode: "vertical",
      verticalPosition: null,
      horizontalPosition: null,
      specialModes: [],
    });
  });

  it.each([
    ["2", ["powerful"]],
    ["12", ["econo"]],
    ["13", ["streamer"]],
    ["13/2", ["powerful", "streamer"]],
    ["", []],
  ] as const)("reads adv=%s as the special modes %j", (adv, specialModes) => {
    expect(parseClassicState({ adv }).specialModes).toEqual(specialModes);
  });

  it("leaves out an adv code outside SpecialMode", () => {
    expect(parseClassicState({ adv: "2/14" }).specialModes).toEqual([
      "powerful",
    ]);
  });

  it("reads any pow but 1 as off", () => {
    expect(parseClassicState({ pow: "0" }).power).toBe(false);
    expect(parseClassicState({}).power).toBe(false);
  });

  it.each([
    ["0", "auto"],
    ["1", "auto"],
    ["7", "auto"],
    ["2", "dehumidify"],
    ["3", "cool"],
    ["4", "heat"],
    ["6", "fan"],
  ])("reads mode=%s as %s", (mode, expected) => {
    expect(parseClassicState({ mode }).mode).toBe(expected);
  });

  it("reads a mode outside the model as auto", () => {
    expect(parseClassicState({ mode: "HUM" }).mode).toBe("auto");
    expect(parseClassicState({}).mode).toBe("auto");
  });

  it.each([
    ["A", "auto"],
    ["B", "silent"],
    ["3", "level1"],
    ["4", "level2"],
    ["5", "level3"],
    ["6", "level4"],
    ["7", "level5"],
  ])("reads f_rate=%s as %s", (f_rate, expected) => {
    expect(parseClassicState({ f_rate }).fanSpeed).toBe(expected);
  });

  it("reads an f_rate outside the model as auto", () => {
    expect(parseClassicState({ f_rate: "9" }).fanSpeed).toBe("auto");
  });

  it.each([
    ["0", "off"],
    ["1", "vertical"],
    ["2", "horizontal"],
    ["3", "both"],
  ])("reads f_dir=%s as %s", (f_dir, expected) => {
    expect(parseClassicState({ f_dir }).swingMode).toBe(expected);
  });

  it("reads an f_dir outside the model as off", () => {
    expect(parseClassicState({ f_dir: "6" }).swingMode).toBe("off");
  });

  it.each([
    ["0", "stop"],
    ["1", "position1"],
    ["2", "position2"],
    ["3", "position3"],
    ["4", "position4"],
    ["5", "position5"],
    ["S", "swing"],
    ["N", "naturalWind"],
    ["A", "auto"],
    ["F", "floorWarming"],
  ])("reads f_dir_ud=%s as %s", (f_dir_ud, expected) => {
    expect(parseClassicState({ f_dir_ud }).verticalPosition).toBe(expected);
  });

  it.each([
    ["0", "stop"],
    ["1", "position1"],
    ["2", "position2"],
    ["3", "position3"],
    ["4", "position4"],
    ["5", "position5"],
    ["S", "swing"],
    ["A", "auto"],
  ])("reads f_dir_lr=%s as %s", (f_dir_lr, expected) => {
    expect(parseClassicState({ f_dir_lr }).horizontalPosition).toBe(expected);
  });

  it("reads a louver value outside the model as null", () => {
    const state = parseClassicState({ f_dir_ud: "C", f_dir_lr: "N" });

    expect(state.verticalPosition).toBeNull();
    expect(state.horizontalPosition).toBeNull();
  });

  it.each(["M", "--", "-", ""])("reads a setpoint of `%s` as null", (value) => {
    const state = parseClassicState({ stemp: value, shum: value });

    expect(state.targetTemperatureInC).toBeNull();
    expect(state.targetHumidity).toBeNull();
  });

  it.each([
    ["0", "off"],
    ["AUTO_L", "autoLow"],
    ["AUTO", "auto"],
    ["AUTO_H", "autoHigh"],
    ["CONTINUE", "continuous"],
  ])("reads shum=%s as %s", (shum, expected) => {
    expect(parseClassicState({ shum }).targetHumidity).toBe(expected);
  });

  it("reads any other number in shum as a percentage", () => {
    expect(parseClassicState({ shum: "50" }).targetHumidity).toEqual({
      percent: 50,
    });
  });

  it("reads a half-degree setpoint", () => {
    expect(parseClassicState({ stemp: "24.5" }).targetTemperatureInC).toBe(
      24.5,
    );
  });
});

describe("parseClassicSensors", () => {
  it("reads a get_sensor_info reply", () => {
    expect(
      parseClassicSensors({
        ret: "OK",
        htemp: "25.5",
        hhum: "60",
        otemp: "-3.0",
      }),
    ).toEqual({
      indoorTemperatureInC: 25.5,
      indoorHumidityInPercent: 60,
      outdoorTemperatureInC: -3,
    });
  });

  it("reads a value that is not a number, or is missing, as null", () => {
    expect(parseClassicSensors({ ret: "OK", hhum: "-", otemp: "" })).toEqual({
      indoorTemperatureInC: null,
      indoorHumidityInPercent: null,
      outdoorTemperatureInC: null,
    });
  });
});

describe("applyClassicControl", () => {
  // The capability fields of units that take no airflow field, `f_dir` alone,
  // and `f_dir` with the louvers.
  const NO_AIRFLOW = { cpv: "3", reg: "sg" };
  const DIRECTION = { ...NO_AIRFLOW, en_fdir: "1" };
  const THREE_D = { ...DIRECTION, en_fdir2: "1" };

  // Off, in heat at 22 °C on level1, with a memory for cool and heat.
  const HEATING = {
    ret: "OK",
    pow: "0",
    mode: "4",
    adv: "",
    stemp: "22.0",
    shum: "0",
    f_rate: "3",
    f_dir: "0",
    dt3: "25.0",
    dt4: "22.0",
    dh3: "0",
    dh4: "0",
    dfr3: "5",
    dfr4: "3",
    b_mode: "4",
  };

  it("writes the current state back when the control is empty", () => {
    expect(applyClassicControl(HEATING, {}, DIRECTION)).toEqual({
      pow: "0",
      mode: "4",
      stemp: "22.0",
      dt4: "22.0",
      shum: "0",
      dh4: "0",
      f_rate: "3",
      f_dir: "0",
    });
  });

  it("writes the control over the current state, and never ret, adv or the other modes' memory", () => {
    expect(
      applyClassicControl(
        HEATING,
        { power: true, targetTemperatureInC: 23 },
        DIRECTION,
      ),
    ).toEqual({
      pow: "1",
      mode: "4",
      stemp: "23.0",
      dt4: "23.0",
      shum: "0",
      dh4: "0",
      f_rate: "3",
      f_dir: "0",
    });
  });

  it("turns the power off", () => {
    expect(
      applyClassicControl({ ...HEATING, pow: "1" }, { power: false }, DIRECTION)
        .pow,
    ).toBe("0");
  });

  it.each([
    [23, "23.0"],
    [23.4, "23.0"],
    [23.5, "24.0"],
  ])(
    "writes the setpoint %s as %s, in stemp and the mode's memory",
    (targetTemperatureInC, stemp) => {
      expect(
        applyClassicControl(HEATING, { targetTemperatureInC }, NO_AIRFLOW),
      ).toMatchObject({ stemp, dt4: stemp });
    },
  );

  it("writes the humidity setting in shum and the mode's memory", () => {
    expect(
      applyClassicControl(
        HEATING,
        { targetHumidity: { percent: 50 } },
        NO_AIRFLOW,
      ),
    ).toMatchObject({ shum: "50", dh4: "50" });
  });

  it.each([
    ["off", "0"],
    ["autoLow", "AUTO_L"],
    ["auto", "AUTO"],
    ["autoHigh", "AUTO_H"],
    ["continuous", "CONTINUE"],
  ] as const)(
    "writes the %s humidity setting as shum=%s",
    (targetHumidity, shum) => {
      expect(
        applyClassicControl(HEATING, { targetHumidity }, NO_AIRFLOW),
      ).toMatchObject({ shum, dh4: shum });
    },
  );

  it("writes no shum and no humidity memory to a subtype=qa unit", () => {
    const qa = { ...NO_AIRFLOW, subtype: "qa" };
    const heating = applyClassicControl(
      HEATING,
      { targetHumidity: { percent: 50 } },
      qa,
    );
    const fan = applyClassicControl(HEATING, { mode: "fan" }, qa);

    expect(heating).toMatchObject({ stemp: "22.0", dt4: "22.0" });
    expect(heating).not.toHaveProperty("shum");
    expect(heating).not.toHaveProperty("dh4");
    expect(fan).not.toHaveProperty("shum");
  });

  it.each(["0", "7"])("writes mode=%s back as mode=1", (mode) => {
    const query = applyClassicControl({ ...HEATING, mode }, {}, NO_AIRFLOW);

    expect(query).toMatchObject({
      mode: "1",
      stemp: "22.0",
      dt1: "22.0",
      shum: "0",
      dh1: "0",
      f_rate: "3",
    });
    expect(query).not.toHaveProperty(`dt${mode}`);
    expect(query).not.toHaveProperty(`dh${mode}`);
  });

  it("sends a mode outside the model back as it came, without a memory", () => {
    expect(
      applyClassicControl({ ...HEATING, mode: "HUM" }, {}, NO_AIRFLOW),
    ).toEqual({
      pow: "0",
      mode: "HUM",
      stemp: "22.0",
      shum: "0",
      f_rate: "3",
    });
  });

  it.each([
    ["auto", "A"],
    ["silent", "B"],
    ["level1", "3"],
    ["level2", "4"],
    ["level3", "5"],
    ["level4", "6"],
    ["level5", "7"],
  ] as const)("writes the %s fan speed as f_rate=%s", (fanSpeed, f_rate) => {
    expect(applyClassicControl(HEATING, { fanSpeed }, NO_AIRFLOW).f_rate).toBe(
      f_rate,
    );
  });

  describe("when the mode changes", () => {
    it("takes the setpoint, humidity and fan speed from the new mode's memory", () => {
      expect(
        applyClassicControl(HEATING, { mode: "cool" }, NO_AIRFLOW),
      ).toEqual({
        pow: "0",
        mode: "3",
        stemp: "25.0",
        dt3: "25.0",
        shum: "0",
        dh3: "0",
        f_rate: "5",
      });
    });

    it("writes the control's values over the memory", () => {
      expect(
        applyClassicControl(
          HEATING,
          {
            mode: "cool",
            targetTemperatureInC: 20,
            targetHumidity: { percent: 40 },
            fanSpeed: "silent",
          },
          NO_AIRFLOW,
        ),
      ).toMatchObject({
        mode: "3",
        stemp: "20.0",
        dt3: "20.0",
        shum: "40",
        dh3: "40",
        f_rate: "B",
      });
    });

    it("keeps the current values when the new mode has no memory", () => {
      expect(
        applyClassicControl(HEATING, { mode: "auto" }, NO_AIRFLOW),
      ).toMatchObject({ stemp: "22.0", shum: "0", f_rate: "3" });
    });

    it("takes f_dir from the new mode's memory", () => {
      expect(
        applyClassicControl(
          { ...HEATING, dfd3: "3" },
          { mode: "cool" },
          DIRECTION,
        ).f_dir,
      ).toBe("3");
    });
  });

  it("writes auto as mode=1", () => {
    expect(
      applyClassicControl(
        { ...HEATING, dt1: "25.0" },
        { mode: "auto" },
        NO_AIRFLOW,
      ),
    ).toMatchObject({ mode: "1", stemp: "25.0", dt1: "25.0" });
  });

  it("writes no setpoint, humidity or memory in fan mode", () => {
    const query = applyClassicControl(
      HEATING,
      {
        mode: "fan",
        targetTemperatureInC: 23,
        targetHumidity: { percent: 50 },
      },
      NO_AIRFLOW,
    );

    expect(query).toMatchObject({ mode: "6", stemp: "--", shum: "--" });
    expect(query).not.toHaveProperty("dt6");
    expect(query).not.toHaveProperty("dh6");
  });

  it("writes the auto fan speed in dehumidify, whatever the control asks for", () => {
    expect(
      applyClassicControl(
        { ...HEATING, dt2: "M" },
        { mode: "dehumidify", fanSpeed: "level5" },
        NO_AIRFLOW,
      ),
    ).toMatchObject({ mode: "2", stemp: "M", f_rate: "A" });
  });

  it("drops a setpoint in dehumidify", () => {
    expect(
      applyClassicControl(
        { ...HEATING, dt2: "M" },
        { mode: "dehumidify", targetTemperatureInC: 20 },
        NO_AIRFLOW,
      ),
    ).toMatchObject({ mode: "2", stemp: "M", dt2: "M" });
  });

  describe("on a unit that takes no airflow field", () => {
    it("writes none", () => {
      const query = applyClassicControl(
        { ...HEATING, f_dir_ud: "0", f_dir_lr: "0" },
        { swingMode: "vertical", verticalPosition: "swing" },
        NO_AIRFLOW,
      );

      expect(query).not.toHaveProperty("f_dir");
      expect(query).not.toHaveProperty("f_dir_ud");
      expect(query).not.toHaveProperty("f_dir_lr");
    });
  });

  describe("on a unit that takes f_dir alone", () => {
    it.each([
      ["off", "0"],
      ["vertical", "1"],
      ["horizontal", "2"],
      ["both", "3"],
    ] as const)("writes the %s swing mode as f_dir=%s", (swingMode, f_dir) => {
      const query = applyClassicControl(HEATING, { swingMode }, DIRECTION);

      expect(query.f_dir).toBe(f_dir);
      expect(query).not.toHaveProperty("f_dir_ud");
      expect(query).not.toHaveProperty("f_dir_lr");
    });

    it("keeps the current f_dir when the control sets no swing mode", () => {
      expect(
        applyClassicControl(
          { ...HEATING, f_dir: "2" },
          { power: true },
          DIRECTION,
        ).f_dir,
      ).toBe("2");
    });
  });

  describe("on a 3D unit", () => {
    // Swinging vertically, with the horizontal louver stopped.
    const SWINGING_VERTICAL = {
      ...HEATING,
      f_dir: "1",
      f_dir_ud: "S",
      f_dir_lr: "0",
    };

    it("keeps the louvers, and f_dir to match, when the control sets no airflow", () => {
      expect(
        applyClassicControl(SWINGING_VERTICAL, { power: true }, THREE_D),
      ).toMatchObject({ f_dir: "1", f_dir_ud: "S", f_dir_lr: "0" });
    });

    it("swings both louvers for the both swing mode", () => {
      expect(
        applyClassicControl(SWINGING_VERTICAL, { swingMode: "both" }, THREE_D),
      ).toMatchObject({ f_dir: "3", f_dir_ud: "S", f_dir_lr: "S" });
    });

    it("stops a swinging louver the swing mode turns off", () => {
      expect(
        applyClassicControl(SWINGING_VERTICAL, { swingMode: "off" }, THREE_D),
      ).toMatchObject({ f_dir: "0", f_dir_ud: "0", f_dir_lr: "0" });
    });

    it("keeps a fixed position on an axis the swing mode leaves off", () => {
      expect(
        applyClassicControl(
          { ...SWINGING_VERTICAL, f_dir_lr: "3" },
          { swingMode: "vertical" },
          THREE_D,
        ),
      ).toMatchObject({ f_dir: "1", f_dir_ud: "S", f_dir_lr: "3" });
    });

    it("writes a louver position, and f_dir to match", () => {
      expect(
        applyClassicControl(
          SWINGING_VERTICAL,
          { verticalPosition: "auto", horizontalPosition: "auto" },
          THREE_D,
        ),
      ).toMatchObject({ f_dir: "0", f_dir_ud: "A", f_dir_lr: "A" });
    });

    it("writes a position over the swing mode sent with it", () => {
      expect(
        applyClassicControl(
          SWINGING_VERTICAL,
          { swingMode: "both", verticalPosition: "position2" },
          THREE_D,
        ),
      ).toMatchObject({ f_dir: "2", f_dir_ud: "2", f_dir_lr: "S" });
    });

    it.each([
      ["stop", "0"],
      ["position1", "1"],
      ["position5", "5"],
      ["swing", "S"],
      ["naturalWind", "N"],
      ["auto", "A"],
      ["floorWarming", "F"],
    ] as const)(
      "writes the %s vertical position as f_dir_ud=%s",
      (verticalPosition, f_dir_ud) => {
        expect(
          applyClassicControl(SWINGING_VERTICAL, { verticalPosition }, THREE_D)
            .f_dir_ud,
        ).toBe(f_dir_ud);
      },
    );

    it.each([
      ["stop", "0"],
      ["position1", "1"],
      ["position5", "5"],
      ["swing", "S"],
      ["auto", "A"],
    ] as const)(
      "writes the %s horizontal position as f_dir_lr=%s",
      (horizontalPosition, f_dir_lr) => {
        expect(
          applyClassicControl(
            SWINGING_VERTICAL,
            { horizontalPosition },
            THREE_D,
          ).f_dir_lr,
        ).toBe(f_dir_lr);
      },
    );

    it("takes the louvers from the new mode's memory when the mode changes", () => {
      expect(
        applyClassicControl(
          { ...SWINGING_VERTICAL, ndfd3: "3S" },
          { mode: "cool" },
          THREE_D,
        ),
      ).toMatchObject({ f_dir: "2", f_dir_ud: "3", f_dir_lr: "S" });
    });

    it("keeps a louver the new mode's memory has no value for", () => {
      expect(
        applyClassicControl(
          { ...SWINGING_VERTICAL, ndfd3: "0-" },
          { mode: "cool" },
          THREE_D,
        ),
      ).toMatchObject({ f_dir_ud: "0", f_dir_lr: "0" });
      expect(
        applyClassicControl(SWINGING_VERTICAL, { mode: "cool" }, THREE_D),
      ).toMatchObject({ f_dir_ud: "S", f_dir_lr: "0" });
    });

    it("ignores the mode's own memory while the mode stays", () => {
      expect(
        applyClassicControl(
          { ...SWINGING_VERTICAL, ndfd4: "3S" },
          { power: true },
          THREE_D,
        ),
      ).toMatchObject({ f_dir_ud: "S", f_dir_lr: "0" });
    });

    it("writes a control's louvers over the new mode's memory", () => {
      expect(
        applyClassicControl(
          { ...SWINGING_VERTICAL, ndfd3: "3S" },
          { mode: "cool", swingMode: "off", verticalPosition: "position1" },
          THREE_D,
        ),
      ).toMatchObject({ f_dir: "0", f_dir_ud: "1", f_dir_lr: "0" });
    });

    it("sends a louver value outside the model back as it came", () => {
      expect(
        applyClassicControl(
          { ...SWINGING_VERTICAL, f_dir_ud: "C" },
          { power: false },
          THREE_D,
        ).f_dir_ud,
      ).toBe("C");
    });

    it("writes stop for a louver the unit reports no value for", () => {
      expect(applyClassicControl(HEATING, {}, THREE_D)).toMatchObject({
        f_dir: "0",
        f_dir_ud: "0",
        f_dir_lr: "0",
      });
    });

    it("writes the louvers without f_dir to a unit that takes no f_dir", () => {
      const query = applyClassicControl(
        SWINGING_VERTICAL,
        { swingMode: "both" },
        { ...NO_AIRFLOW, en_fdir2: "1" },
      );

      expect(query).toMatchObject({ f_dir_ud: "S", f_dir_lr: "S" });
      expect(query).not.toHaveProperty("f_dir");
    });
  });
});
