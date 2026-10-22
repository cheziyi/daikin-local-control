import {
  type DaikinControl,
  type DaikinSensors,
  type DaikinState,
  type FanSpeed,
  type HorizontalPosition,
  type HumiditySetting,
  type OperatingMode,
  SPECIAL_MODES,
  type SpecialMode,
  type SwingMode,
  type TargetHumidity,
  type VerticalPosition,
} from "../../models/state.js";
import { takesClassicDirection, takesClassicHumidity } from "./capabilities.js";
import {
  CLASSIC_FAN_SPEED_CODES,
  CLASSIC_FLOOR_WARMING_DIRECTION,
  CLASSIC_HORIZONTAL_POSITION_CODES,
  CLASSIC_HUMIDITY_SETTING_CODES,
  CLASSIC_LOUVER_STOP,
  CLASSIC_LOUVER_SWING,
  CLASSIC_NO_SETPOINT,
  CLASSIC_OPERATING_MODE_ALIASES,
  CLASSIC_OPERATING_MODE_CODES,
  CLASSIC_SPECIAL_MODE_ADV_CODES,
  CLASSIC_SWING_MODE_CODES,
  CLASSIC_VERTICAL_POSITION_CODES,
} from "./tables.js";

// Maps between `DaikinState` and the classic `control_info` wire fields, and reads
// `DaikinSensors` from `get_sensor_info`.

const OPERATING_MODES_BY_CODE: Record<string, OperatingMode> = {
  ...Object.fromEntries(
    Object.entries(CLASSIC_OPERATING_MODE_CODES).map(([mode, code]) => [
      code,
      mode as OperatingMode,
    ]),
  ),
  ...CLASSIC_OPERATING_MODE_ALIASES,
};

const FAN_SPEEDS_BY_CODE: Record<string, FanSpeed> = Object.fromEntries(
  Object.entries(CLASSIC_FAN_SPEED_CODES).map(([speed, code]) => [
    code,
    speed as FanSpeed,
  ]),
);

const SWING_MODES_BY_CODE: Record<string, SwingMode> = Object.fromEntries(
  Object.entries(CLASSIC_SWING_MODE_CODES).map(([swing, code]) => [
    code,
    swing as SwingMode,
  ]),
);

const VERTICAL_POSITIONS_BY_CODE: Record<string, VerticalPosition> =
  Object.fromEntries(
    Object.entries(CLASSIC_VERTICAL_POSITION_CODES).map(([position, code]) => [
      code,
      position as VerticalPosition,
    ]),
  );

const HORIZONTAL_POSITIONS_BY_CODE: Record<string, HorizontalPosition> =
  Object.fromEntries(
    Object.entries(CLASSIC_HORIZONTAL_POSITION_CODES).map(
      ([position, code]) => [code, position as HorizontalPosition],
    ),
  );

const HUMIDITY_SETTINGS_BY_CODE: Record<string, HumiditySetting> =
  Object.fromEntries(
    Object.entries(CLASSIC_HUMIDITY_SETTING_CODES).map(([setting, code]) => [
      code,
      setting as HumiditySetting,
    ]),
  );

// Dehumidify runs the fan on auto only.
const DEHUMIDIFY_FAN_SPEED = CLASSIC_FAN_SPEED_CODES.auto;
// In `ndfd<mode>`, a louver the unit lacks.
const NO_LOUVER = "-";

/** Turns a `get_control_info` reply into a `DaikinState`. A `mode` or `f_rate`
 * outside the model reads as `auto`, an `f_dir` outside it as `off`, and an
 * `f_dir_ud` or `f_dir_lr` outside it as `null`. A code in `adv` outside
 * `SpecialMode` is left out. */
export function parseClassicState(fields: Record<string, string>): DaikinState {
  return {
    power: fields.pow === "1",
    mode: OPERATING_MODES_BY_CODE[fields.mode ?? ""] ?? "auto",
    targetTemperatureInC: parseNumeric(fields.stemp),
    targetHumidity: parseTargetHumidity(fields.shum),
    fanSpeed: FAN_SPEEDS_BY_CODE[fields.f_rate ?? ""] ?? "auto",
    swingMode: SWING_MODES_BY_CODE[fields.f_dir ?? ""] ?? "off",
    verticalPosition: VERTICAL_POSITIONS_BY_CODE[fields.f_dir_ud ?? ""] ?? null,
    horizontalPosition:
      HORIZONTAL_POSITIONS_BY_CODE[fields.f_dir_lr ?? ""] ?? null,
    specialModes: parseSpecialModes(fields.adv),
  };
}

export function parseClassicSensors(
  fields: Record<string, string>,
): DaikinSensors {
  return {
    indoorTemperatureInC: parseNumeric(fields.htemp),
    outdoorTemperatureInC: parseNumeric(fields.otemp),
    indoorHumidityInPercent: parseNumeric(fields.hhum),
  };
}

/** Turns `current`, the `get_control_info` reply, and a control into the
 * `set_control_info` query: power and mode, the setpoint, humidity and fan
 * speed for the target mode, and the airflow fields the unit takes. When the
 * mode changes, each comes from the target mode's memory: `dt`, `dh`, `dfr`,
 * and `dfd` or, on a unit that reports `ndfd` alone, the `f_dir` its two
 * louver values stand for. On a 3D unit the louvers come from `ndfd`, and
 * `f_dir` is 6 while the vertical one is at floor warming. `capabilityFields`, the field map of
 * `mergeClassicCapabilityFields`, says which fields the unit takes: `shum`
 * unless it is `subtype=qa`, `f_dir_ud` and `f_dir_lr` on a 3D unit
 * (`en_fdir2`), and `f_dir` on a unit that takes a direction. It rounds a
 * `targetTemperatureInC` to the whole degree and drops one in dehumidify, writes `mode=0` and `mode=7` as
 * `mode=1`, and never echoes `ret`, `adv` or the other modes' memory. */
export function applyClassicControl(
  current: Record<string, string>,
  control: DaikinControl,
  capabilityFields: Record<string, string>,
): Record<string, string> {
  const takesDirection = takesClassicDirection(capabilityFields);
  const heldMode = OPERATING_MODES_BY_CODE[current.mode ?? ""];
  // A mode outside the model is sent back as it came.
  const currentMode =
    heldMode === undefined
      ? (current.mode ?? "")
      : CLASSIC_OPERATING_MODE_CODES[heldMode];
  const mode =
    control.mode === undefined
      ? currentMode
      : CLASSIC_OPERATING_MODE_CODES[control.mode];
  const modeChanged = mode !== currentMode;
  const remembered = (field: string, memoryPrefix: string) =>
    (modeChanged ? current[`${memoryPrefix}${mode}`] : undefined) ??
    current[field] ??
    "";

  const power = control.power ?? current.pow === "1";
  const next: Record<string, string> = { pow: power ? "1" : "0", mode };

  const setpointFrozen = mode === CLASSIC_OPERATING_MODE_CODES.fan;
  // Only a mode in the model has a `dt` and a `dh` memory.
  const hasMemory =
    !setpointFrozen && (control.mode !== undefined || heldMode !== undefined);
  next.stemp = setpointFrozen
    ? CLASSIC_NO_SETPOINT
    : control.targetTemperatureInC != null &&
        mode !== CLASSIC_OPERATING_MODE_CODES.dehumidify
      ? Math.round(control.targetTemperatureInC).toFixed(1)
      : remembered("stemp", "dt");
  if (hasMemory) {
    next[`dt${mode}`] = next.stemp;
  }
  if (takesClassicHumidity(capabilityFields)) {
    next.shum = setpointFrozen
      ? CLASSIC_NO_SETPOINT
      : control.targetHumidity != null
        ? encodeTargetHumidity(control.targetHumidity)
        : remembered("shum", "dh");
    if (hasMemory) {
      next[`dh${mode}`] = next.shum;
    }
  }

  next.f_rate =
    mode === CLASSIC_OPERATING_MODE_CODES.dehumidify
      ? DEHUMIDIFY_FAN_SPEED
      : control.fanSpeed === undefined
        ? remembered("f_rate", "dfr")
        : CLASSIC_FAN_SPEED_CODES[control.fanSpeed];

  if (capabilityFields.en_fdir2 === "1") {
    // `ndfd<mode>` holds the mode's `f_dir_ud` value, then its `f_dir_lr`
    // value. A value outside the model is sent back as it came.
    const louverMemory = modeChanged ? current[`ndfd${mode}`] : undefined;
    let vertical =
      rememberedLouver(louverMemory, 0) ||
      current.f_dir_ud ||
      CLASSIC_LOUVER_STOP;
    let horizontal =
      rememberedLouver(louverMemory, 1) ||
      current.f_dir_lr ||
      CLASSIC_LOUVER_STOP;
    if (control.swingMode !== undefined) {
      const swingsVertically =
        control.swingMode === "vertical" || control.swingMode === "both";
      const swingsHorizontally =
        control.swingMode === "horizontal" || control.swingMode === "both";
      vertical = swingsVertically
        ? CLASSIC_LOUVER_SWING
        : vertical === CLASSIC_LOUVER_SWING
          ? CLASSIC_LOUVER_STOP
          : vertical;
      horizontal = swingsHorizontally
        ? CLASSIC_LOUVER_SWING
        : horizontal === CLASSIC_LOUVER_SWING
          ? CLASSIC_LOUVER_STOP
          : horizontal;
    }
    if (control.verticalPosition != null) {
      vertical = CLASSIC_VERTICAL_POSITION_CODES[control.verticalPosition];
    }
    if (control.horizontalPosition != null) {
      horizontal =
        CLASSIC_HORIZONTAL_POSITION_CODES[control.horizontalPosition];
    }
    next.f_dir_ud = vertical;
    next.f_dir_lr = horizontal;
    if (takesDirection) {
      next.f_dir = directionOf(vertical, horizontal);
    }
  } else if (takesDirection) {
    next.f_dir =
      control.swingMode === undefined
        ? ((modeChanged
            ? (current[`dfd${mode}`] ??
              decodeLouverMemory(current[`ndfd${mode}`]))
            : undefined) ??
          current.f_dir ??
          "")
        : CLASSIC_SWING_MODE_CODES[control.swingMode];
  }
  return next;
}

// `f_dir` sets bit 1 while the vertical louver swings and bit 2 while the
// horizontal one does, and is 6 while the vertical one is at floor warming.
function directionOf(vertical: string, horizontal: string): string {
  if (vertical === CLASSIC_VERTICAL_POSITION_CODES.floorWarming) {
    return CLASSIC_FLOOR_WARMING_DIRECTION;
  }
  return String(
    (vertical === CLASSIC_LOUVER_SWING ? 1 : 0) |
      (horizontal === CLASSIC_LOUVER_SWING ? 2 : 0),
  );
}

// The `f_dir` an `ndfd<mode>` value stands for, on a unit that reports no
// `dfd<mode>`. A fixed position counts as stop.
function decodeLouverMemory(ndfd: string | undefined): string | undefined {
  if (ndfd === undefined || ndfd.length !== 2) {
    return undefined;
  }
  const [vertical = "", horizontal = ""] = ndfd;
  return directionOf(vertical, horizontal);
}

function parseSpecialModes(adv: string | undefined): SpecialMode[] {
  const codes = (adv ?? "").split("/");
  return SPECIAL_MODES.filter((mode) =>
    codes.includes(CLASSIC_SPECIAL_MODE_ADV_CODES[mode]),
  );
}

function parseTargetHumidity(shum: string | undefined): TargetHumidity | null {
  const setting = HUMIDITY_SETTINGS_BY_CODE[shum ?? ""];
  if (setting !== undefined) {
    return setting;
  }
  const percent = parseNumeric(shum);
  return percent === null ? null : { percent };
}

function encodeTargetHumidity(targetHumidity: TargetHumidity): string {
  return typeof targetHumidity === "string"
    ? CLASSIC_HUMIDITY_SETTING_CODES[targetHumidity]
    : String(targetHumidity.percent);
}

function rememberedLouver(
  louverMemory: string | undefined,
  index: number,
): string | undefined {
  const value = louverMemory?.[index];
  return value === NO_LOUVER ? undefined : value;
}

function parseNumeric(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  // Modes without a setpoint answer "M", "--" or "-", which are not numbers.
  return Number.isFinite(parsed) ? parsed : null;
}
