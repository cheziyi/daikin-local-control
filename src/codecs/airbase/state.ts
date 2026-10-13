import type {
  DaikinControl,
  DaikinSensors,
  DaikinState,
  FanSpeed,
  OperatingMode,
  SwingMode,
} from "../../models/state.js";
import {
  AIRBASE_FAN_SPEED_CODES,
  AIRBASE_NO_SETPOINT,
  AIRBASE_OPERATING_MODE_CODES,
  AIRBASE_SWING_MODE_CODES,
} from "./tables.js";

// Maps between `DaikinState` and an Airbase adapter's `control_info` fields,
// and reads `DaikinSensors` from its `get_sensor_info`.
//
// The unit remembers a setpoint, a fan and a direction for cool and for heat
// alone: `dt2`, `dfr2`, `dfd2`, `auto2` and `airside2` for cool, and the same
// fields ending in 1 for heat. Auto, fan and dehumidify run on one of the
// two, the one `bk_auto` names.

const OPERATING_MODES_BY_CODE: Record<string, OperatingMode> =
  Object.fromEntries(
    Object.entries(AIRBASE_OPERATING_MODE_CODES).map(([mode, code]) => [
      code,
      mode as OperatingMode,
    ]),
  );

const FAN_SPEEDS_BY_CODE: Record<string, FanSpeed> = Object.fromEntries(
  Object.entries(AIRBASE_FAN_SPEED_CODES).map(([speed, code]) => [
    code,
    speed as FanSpeed,
  ]),
);

const SWING_MODES_BY_CODE: Record<string, SwingMode> = Object.fromEntries(
  Object.entries(AIRBASE_SWING_MODE_CODES).map(([swing, code]) => [
    code,
    swing as SwingMode,
  ]),
);

const ON = "1";
const OFF = "0";
// What airside runs the fan at.
const AIRSIDE_FAN_SPEED = AIRBASE_FAN_SPEED_CODES.level1;

/** Turns a `get_control_info` reply into a `DaikinState`. A `mode` or `f_rate`
 * outside the model reads as `auto`, and an `f_dir` outside it as `off`. It
 * reports no humidity setting, louver position or special mode: an Airbase
 * unit is not known to have any. */
export function parseAirbaseState(fields: Record<string, string>): DaikinState {
  return {
    power: fields.pow === ON,
    mode: OPERATING_MODES_BY_CODE[fields.mode ?? ""] ?? "auto",
    targetTemperatureInC: parseNumeric(fields.stemp),
    targetHumidity: null,
    fanSpeed: FAN_SPEEDS_BY_CODE[fields.f_rate ?? ""] ?? "auto",
    swingMode: SWING_MODES_BY_CODE[fields.f_dir ?? ""] ?? "off",
    verticalPosition: null,
    horizontalPosition: null,
    specialModes: [],
  };
}

export function parseAirbaseSensors(
  fields: Record<string, string>,
): DaikinSensors {
  return {
    indoorTemperatureInC: parseNumeric(fields.htemp),
    outdoorTemperatureInC: parseNumeric(fields.otemp),
    indoorHumidityInPercent: parseNumeric(fields.hhum),
  };
}

/** Whether fan auto is on in a `get_control_info` reply: the unit then picks
 * the fan speed itself, up to the one that is set. */
export function parseAirbaseFanAuto(fields: Record<string, string>): boolean {
  return fields.f_auto === ON;
}

/** Whether airside is on in a `get_control_info` reply. */
export function parseAirbaseAirside(fields: Record<string, string>): boolean {
  return fields.f_airside === ON;
}

/** Turns `current`, the `get_control_info` reply, and a control into the
 * `set_control_info` query: power, mode, setpoint, humidity, fan speed, fan
 * auto, airside and direction, every time. When the mode changes, the
 * setpoint, the fan and the direction come from what the unit remembers for
 * cool or for heat. It drops a `targetTemperatureInC` in fan and dehumidify,
 * every `targetHumidity` and louver position, and sends `shum` back as the
 * unit holds it. A `fanSpeed` switches airside off and keeps fan auto. */
export function applyAirbaseControl(
  current: Record<string, string>,
  control: DaikinControl,
): Record<string, string> {
  return buildControl(current, control, {});
}

/** Turns `current`, the `get_control_info` reply, into the `set_control_info`
 * query that switches fan auto on or off. It switches airside off, and keeps
 * the fan speed. */
export function applyAirbaseFanAuto(
  current: Record<string, string>,
  enabled: boolean,
): Record<string, string> {
  return buildControl(current, {}, { auto: enabled });
}

/** Turns `current`, the `get_control_info` reply, into the `set_control_info`
 * query that switches airside on or off. Switching it on switches fan auto
 * off and sets the lowest fan speed, which airside runs at. */
export function applyAirbaseAirside(
  current: Record<string, string>,
  enabled: boolean,
): Record<string, string> {
  return buildControl(current, {}, { airside: enabled });
}

function buildControl(
  current: Record<string, string>,
  control: DaikinControl,
  fan: { auto?: boolean; airside?: boolean },
): Record<string, string> {
  const { cool, heat, fan: fanMode, dehumidify } = AIRBASE_OPERATING_MODE_CODES;
  // A mode outside the model is sent back as it came.
  const currentMode = current.mode ?? "";
  const mode =
    control.mode === undefined
      ? currentMode
      : AIRBASE_OPERATING_MODE_CODES[control.mode];
  const modeChanged = mode !== currentMode;

  // A change to cool or to heat makes that mode the one the others run on.
  const backing =
    modeChanged && (mode === cool || mode === heat) ? mode : current.bk_auto;
  // Which of the two memories applies: heat's, or cool's for anything else.
  const memory = (backing || mode) === heat ? heat : cool;
  const remembered = (field: string, memoryPrefix: string, fallback: string) =>
    (modeChanged ? current[`${memoryPrefix}${memory}`] : undefined) ||
    current[field] ||
    fallback;

  const power = control.power ?? current.pow === ON;
  const next: Record<string, string> = { pow: power ? ON : OFF, mode };
  if (backing) {
    next.bk_auto = backing;
  }

  next.stemp =
    mode === dehumidify
      ? AIRBASE_NO_SETPOINT
      : control.targetTemperatureInC != null && mode !== fanMode
        ? control.targetTemperatureInC.toFixed(1)
        : remembered("stemp", "dt", AIRBASE_NO_SETPOINT);
  // Each mode's setpoint is written to its own memory as well, and auto's to
  // the memory of the mode it runs on.
  const setpointMemory =
    mode === cool || mode === heat || mode === fanMode || mode === dehumidify
      ? mode
      : mode === AIRBASE_OPERATING_MODE_CODES.auto && backing
        ? memory
        : undefined;
  if (setpointMemory !== undefined) {
    next[`dt${setpointMemory}`] = next.stemp;
  }
  next.shum = current.shum || AIRBASE_NO_SETPOINT;

  next.f_rate =
    control.fanSpeed === undefined
      ? remembered("f_rate", "dfr", AIRBASE_FAN_SPEED_CODES.auto)
      : AIRBASE_FAN_SPEED_CODES[control.fanSpeed];
  next.f_auto = remembered("f_auto", "auto", OFF);
  next.f_airside = remembered("f_airside", "airside", OFF);
  const fanChanged = control.fanSpeed !== undefined || fan.auto !== undefined;
  if (fan.auto !== undefined) {
    next.f_auto = fan.auto ? ON : OFF;
  }
  if (fanChanged) {
    next.f_airside = OFF;
  }
  if (fan.airside !== undefined) {
    next.f_airside = fan.airside ? ON : OFF;
  }
  if (fan.airside) {
    next.f_rate = AIRSIDE_FAN_SPEED;
  }
  // Airside and fan auto are never on together.
  if (next.f_airside === ON) {
    next.f_auto = OFF;
  }
  // A change to the fan is written to the memory as well.
  if (fanChanged) {
    next[`dfr${memory}`] = next.f_rate;
    next[`auto${memory}`] = next.f_auto;
  }
  if (fanChanged || fan.airside !== undefined) {
    next[`airside${memory}`] = next.f_airside;
  }

  next.f_dir =
    control.swingMode === undefined
      ? remembered("f_dir", "dfd", AIRBASE_SWING_MODE_CODES.off)
      : AIRBASE_SWING_MODE_CODES[control.swingMode];
  if (control.swingMode !== undefined) {
    next[`dfd${memory}`] = next.f_dir;
  }
  return next;
}

function parseNumeric(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  // A reading the unit lacks is "-", and a mode without a setpoint holds
  // "--" or a letter, none of which is a number.
  return Number.isFinite(parsed) ? parsed : null;
}
