import { describe, expect, it } from "vitest";
import {
  applyAirbaseAirside,
  applyAirbaseControl,
  applyAirbaseFanAuto,
  parseAirbaseAirside,
  parseAirbaseFanAuto,
  parseAirbaseSensors,
  parseAirbaseState,
} from "../state.js";

// A unit in cool at 24 °C on the middle fan speed. It remembers 24 °C and the
// middle speed for cool, and 21 °C and the highest speed on fan auto for heat.
const COOLING = {
  ret: "OK",
  pow: "1",
  mode: "2",
  stemp: "24.0",
  shum: "0",
  f_rate: "3",
  f_auto: "0",
  f_airside: "0",
  f_dir: "0",
  bk_auto: "2",
  dt1: "21.0",
  dt2: "24.0",
  dfr1: "5",
  dfr2: "3",
  dfd1: "1",
  dfd2: "0",
  auto1: "1",
  auto2: "0",
  airside1: "0",
  airside2: "0",
};

describe("parseAirbaseState", () => {
  it("reads a get_control_info reply", () => {
    expect(parseAirbaseState(COOLING)).toEqual({
      power: true,
      mode: "cool",
      targetTemperatureInC: 24,
      targetHumidity: null,
      fanSpeed: "level3",
      swingMode: "off",
      verticalPosition: "position1",
      horizontalPosition: null,
      specialModes: [],
    });
  });

  it("reads each mode by an Airbase adapter's own code", () => {
    const modeOf = (mode: string) => parseAirbaseState({ mode }).mode;

    expect(["0", "1", "2", "3", "7"].map(modeOf)).toEqual([
      "fan",
      "heat",
      "cool",
      "auto",
      "dehumidify",
    ]);
  });

  it("reads each fan speed and louver position by its code", () => {
    const fanSpeedOf = (f_rate: string) =>
      parseAirbaseState({ f_rate }).fanSpeed;
    const positionOf = (f_dir: string) =>
      parseAirbaseState({ f_dir }).verticalPosition;

    expect(["0", "1", "3", "5", "B"].map(fanSpeedOf)).toEqual([
      "auto",
      "level1",
      "level3",
      "level5",
      "silent",
    ]);
    expect(["0", "1", "2", "3", "4", "6", "7"].map(positionOf)).toEqual([
      "position1",
      "position2",
      "position3",
      "position4",
      "position5",
      "stop",
      "swing",
    ]);
  });

  it("reads the swing mode as vertical while the louver swings", () => {
    expect(parseAirbaseState({ f_dir: "7" }).swingMode).toBe("vertical");
    expect(parseAirbaseState({ f_dir: "2" }).swingMode).toBe("off");
  });

  it("reads a mode or fan speed outside the model as auto, and a direction as null", () => {
    expect(
      parseAirbaseState({ mode: "HUM", f_rate: "9", f_dir: "5" }),
    ).toMatchObject({
      mode: "auto",
      fanSpeed: "auto",
      swingMode: "off",
      verticalPosition: null,
    });
  });

  it("reads a setpoint that is not a number as null", () => {
    expect(parseAirbaseState({ stemp: "--" }).targetTemperatureInC).toBeNull();
    expect(parseAirbaseState({ stemp: "M" }).targetTemperatureInC).toBeNull();
    expect(parseAirbaseState({}).targetTemperatureInC).toBeNull();
  });

  it("reads power off unless pow is 1", () => {
    expect(parseAirbaseState({ pow: "0" }).power).toBe(false);
    expect(parseAirbaseState({}).power).toBe(false);
  });
});

describe("parseAirbaseSensors", () => {
  it("reads each temperature, and null for a reading the unit lacks", () => {
    expect(parseAirbaseSensors({ htemp: "25.0", otemp: "-" })).toEqual({
      indoorTemperatureInC: 25,
      outdoorTemperatureInC: null,
      indoorHumidityInPercent: null,
    });
    expect(parseAirbaseSensors({ otemp: "31.5", hhum: "50" })).toEqual({
      indoorTemperatureInC: null,
      outdoorTemperatureInC: 31.5,
      indoorHumidityInPercent: 50,
    });
  });
});

describe("parseAirbaseFanAuto and parseAirbaseAirside", () => {
  it("read f_auto and f_airside", () => {
    expect(parseAirbaseFanAuto({ f_auto: "1" })).toBe(true);
    expect(parseAirbaseFanAuto(COOLING)).toBe(false);
    expect(parseAirbaseAirside({ f_airside: "1" })).toBe(true);
    expect(parseAirbaseAirside(COOLING)).toBe(false);
  });
});

describe("applyAirbaseControl", () => {
  it("sends every control field back when the control changes nothing", () => {
    expect(applyAirbaseControl(COOLING, {})).toEqual({
      pow: "1",
      mode: "2",
      bk_auto: "2",
      stemp: "24.0",
      dt2: "24.0",
      shum: "0",
      f_rate: "3",
      f_auto: "0",
      f_airside: "0",
      f_dir: "0",
    });
  });

  it("switches the power", () => {
    expect(applyAirbaseControl(COOLING, { power: false })).toMatchObject({
      pow: "0",
      mode: "2",
    });
    expect(
      applyAirbaseControl({ ...COOLING, pow: "0" }, { power: true }).pow,
    ).toBe("1");
  });

  it("writes a setpoint as a whole number, rounded, and to the mode's memory", () => {
    expect(
      applyAirbaseControl(COOLING, { targetTemperatureInC: 22 }),
    ).toMatchObject({ stemp: "22", dt2: "22" });
    expect(
      applyAirbaseControl(COOLING, { targetTemperatureInC: 22.6 }),
    ).toMatchObject({ stemp: "23", dt2: "23" });
  });

  it("takes what the unit remembers for heat on a change to heat", () => {
    expect(applyAirbaseControl(COOLING, { mode: "heat" })).toEqual({
      pow: "1",
      mode: "1",
      bk_auto: "1",
      stemp: "21.0",
      dt1: "21.0",
      shum: "0",
      f_rate: "5",
      f_auto: "1",
      f_airside: "0",
      f_dir: "1",
    });
  });

  it("lets the control override what the unit remembers for the new mode", () => {
    expect(
      applyAirbaseControl(COOLING, {
        mode: "heat",
        targetTemperatureInC: 19,
        fanSpeed: "level1",
        verticalPosition: "swing",
      }),
    ).toMatchObject({
      mode: "1",
      stemp: "19",
      dt1: "19",
      f_rate: "1",
      dfr1: "1",
      f_dir: "7",
      dfd1: "7",
    });
  });

  it("runs cool and heat on their own memory, whatever bk_auto names", () => {
    expect(
      applyAirbaseControl({ ...COOLING, bk_auto: "1" }, { fanSpeed: "level1" }),
    ).toMatchObject({ mode: "2", bk_auto: "2", f_rate: "1", dfr2: "1" });
  });

  it("runs auto and fan on the mode bk_auto names", () => {
    const heating = { ...COOLING, mode: "1", bk_auto: "1" };

    expect(applyAirbaseControl(COOLING, { mode: "auto" })).toMatchObject({
      mode: "3",
      bk_auto: "2",
      stemp: "24.0",
      dt2: "24.0",
      f_rate: "3",
    });
    expect(applyAirbaseControl(heating, { mode: "auto" })).toMatchObject({
      mode: "3",
      bk_auto: "1",
      stemp: "21.0",
      dt1: "21.0",
      f_rate: "5",
    });
    expect(applyAirbaseControl(heating, { mode: "fan" })).toMatchObject({
      mode: "0",
      bk_auto: "1",
      stemp: "21.0",
      dt0: "21.0",
      f_rate: "5",
    });
  });

  it("sends no setpoint in dehumidify, and drops one the control sets", () => {
    expect(
      applyAirbaseControl(COOLING, {
        mode: "dehumidify",
        targetTemperatureInC: 22,
      }),
    ).toMatchObject({ mode: "7", stemp: "--", dt7: "--" });
  });

  it("drops a setpoint the control sets in fan", () => {
    const fanning = { ...COOLING, mode: "0" };

    expect(
      applyAirbaseControl(fanning, { targetTemperatureInC: 22 }),
    ).toMatchObject({ stemp: "24.0", dt0: "24.0" });
  });

  it("sends no bk_auto, and no setpoint memory in auto, for a unit that reports none", () => {
    const { bk_auto: _, ...withoutBacking } = { ...COOLING, mode: "3" };

    const query = applyAirbaseControl(withoutBacking, {});

    expect(query).not.toHaveProperty("bk_auto");
    expect(Object.keys(query).filter((key) => key.startsWith("dt"))).toEqual(
      [],
    );
  });

  it("writes a fan speed to the memory, switches airside off and keeps fan auto", () => {
    const onAirside = { ...COOLING, f_rate: "1", f_airside: "1" };
    const onFanAuto = { ...COOLING, f_auto: "1" };

    expect(
      applyAirbaseControl(onAirside, { fanSpeed: "level5" }),
    ).toMatchObject({
      f_rate: "5",
      dfr2: "5",
      f_auto: "0",
      auto2: "0",
      f_airside: "0",
      airside2: "0",
    });
    expect(
      applyAirbaseControl(onFanAuto, { fanSpeed: "level1" }),
    ).toMatchObject({
      f_rate: "1",
      dfr2: "1",
      f_auto: "1",
      auto2: "1",
      f_airside: "0",
    });
  });

  it("writes a louver position to the memory", () => {
    expect(
      applyAirbaseControl(COOLING, { verticalPosition: "position3" }),
    ).toMatchObject({ f_dir: "2", dfd2: "2" });
    expect(
      applyAirbaseControl(COOLING, { verticalPosition: "swing" }),
    ).toMatchObject({ f_dir: "7", dfd2: "7" });
  });

  it("writes no fan or direction memory for a control that sets neither", () => {
    const query = applyAirbaseControl(COOLING, { targetTemperatureInC: 22 });

    for (const field of ["dfr2", "auto2", "airside2", "dfd2"]) {
      expect(query).not.toHaveProperty(field);
    }
  });

  it("drops a humidity setting, a swing mode and a horizontal position", () => {
    expect(
      applyAirbaseControl(COOLING, {
        targetHumidity: "auto",
        swingMode: "vertical",
        horizontalPosition: "swing",
      }),
    ).toEqual(applyAirbaseControl(COOLING, {}));
  });

  it.each([
    "stop",
    "naturalWind",
    "auto",
    "floorWarming",
    "circulating",
  ] as const)(
    "drops the %s vertical position, which the unit does not take",
    (verticalPosition) => {
      expect(applyAirbaseControl(COOLING, { verticalPosition })).toEqual(
        applyAirbaseControl(COOLING, {}),
      );
    },
  );

  it("sends a mode outside the model back as it came, and -- for a missing shum", () => {
    expect(
      applyAirbaseControl({ pow: "1", mode: "HUM", stemp: "24.0" }, {}),
    ).toEqual({
      pow: "1",
      mode: "HUM",
      stemp: "24.0",
      shum: "--",
      f_rate: "0",
      f_auto: "0",
      f_airside: "0",
      f_dir: "0",
    });
  });
});

describe("applyAirbaseFanAuto", () => {
  it("switches fan auto on, keeps the fan speed and switches airside off", () => {
    const onAirside = { ...COOLING, f_rate: "1", f_airside: "1" };

    expect(applyAirbaseFanAuto(COOLING, true)).toEqual({
      ...applyAirbaseControl(COOLING, {}),
      f_auto: "1",
      auto2: "1",
      dfr2: "3",
      airside2: "0",
    });
    expect(applyAirbaseFanAuto(onAirside, true)).toMatchObject({
      f_rate: "1",
      f_auto: "1",
      f_airside: "0",
      airside2: "0",
    });
  });

  it("switches fan auto off", () => {
    expect(
      applyAirbaseFanAuto({ ...COOLING, f_auto: "1" }, false),
    ).toMatchObject({ f_rate: "3", f_auto: "0", auto2: "0" });
  });
});

describe("applyAirbaseAirside", () => {
  it("switches airside on at the lowest fan speed, with fan auto off", () => {
    expect(applyAirbaseAirside({ ...COOLING, f_auto: "1" }, true)).toEqual({
      ...applyAirbaseControl(COOLING, {}),
      f_rate: "1",
      f_auto: "0",
      f_airside: "1",
      airside2: "1",
    });
  });

  it("switches airside off, and keeps the fan speed", () => {
    const onAirside = { ...COOLING, f_rate: "1", f_airside: "1" };

    expect(applyAirbaseAirside(onAirside, false)).toEqual({
      ...applyAirbaseControl(COOLING, {}),
      f_rate: "1",
      f_airside: "0",
      airside2: "0",
    });
  });

  it("writes to heat's memory on a unit that runs on heat", () => {
    const heating = { ...COOLING, mode: "3", bk_auto: "1" };

    expect(applyAirbaseAirside(heating, true)).toMatchObject({ airside1: "1" });
  });
});
