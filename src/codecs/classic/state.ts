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

// Maps between `DaikinState` and the classic `control_info` wire fields, and reads
// `DaikinSensors` from `get_sensor_info`.

const OPERATING_MODE_CODES: Record<OperatingMode, string> = {
  auto: "1",
  dehumidify: "2",
  cool: "3",
  heat: "4",
  fan: "6",
};

const OPERATING_MODES_BY_CODE: Record<string, OperatingMode> = {
  "0": "auto",
  "1": "auto",
  "7": "auto",
  "2": "dehumidify",
  "3": "cool",
  "4": "heat",
  "6": "fan",
};

const FAN_SPEED_CODES: Record<FanSpeed, string> = {
  auto: "A",
  silent: "B",
  level1: "3",
  level2: "4",
  level3: "5",
  level4: "6",
  level5: "7",
};

const FAN_SPEEDS_BY_CODE: Record<string, FanSpeed> = Object.fromEntries(
  Object.entries(FAN_SPEED_CODES).map(([speed, code]) => [
    code,
    speed as FanSpeed,
  ]),
);

const SWING_MODE_CODES: Record<SwingMode, string> = {
  off: "0",
  vertical: "1",
  horizontal: "2",
  both: "3",
};

const SWING_MODES_BY_CODE: Record<string, SwingMode> = Object.fromEntries(
  Object.entries(SWING_MODE_CODES).map(([swing, code]) => [
    code,
    swing as SwingMode,
  ]),
);

// `f_dir_ud` and `f_dir_lr` carry a digit for stop and each fixed position, and
// a letter for the rest.
const LOUVER_STOP = "0";
const LOUVER_SWING = "S";
const VERTICAL_POSITION_CODES: Record<VerticalPosition, string> = {
  stop: LOUVER_STOP,
  position1: "1",
  position2: "2",
  position3: "3",
  position4: "4",
  position5: "5",
  swing: LOUVER_SWING,
  naturalWind: "N",
  auto: "A",
  floorWarming: "F",
};
const HORIZONTAL_POSITION_CODES: Record<HorizontalPosition, string> = {
  stop: LOUVER_STOP,
  position1: "1",
  position2: "2",
  position3: "3",
  position4: "4",
  position5: "5",
  swing: LOUVER_SWING,
  auto: "A",
};

const VERTICAL_POSITIONS_BY_CODE: Record<string, VerticalPosition> =
  Object.fromEntries(
    Object.entries(VERTICAL_POSITION_CODES).map(([position, code]) => [
      code,
      position as VerticalPosition,
    ]),
  );

const HORIZONTAL_POSITIONS_BY_CODE: Record<string, HorizontalPosition> =
  Object.fromEntries(
    Object.entries(HORIZONTAL_POSITION_CODES).map(([position, code]) => [
      code,
      position as HorizontalPosition,
    ]),
  );

const HUMIDITY_SETTING_CODES: Record<HumiditySetting, string> = {
  off: "0",
  autoLow: "AUTO_L",
  auto: "AUTO",
  autoHigh: "AUTO_H",
  continuous: "CONTINUE",
};

const HUMIDITY_SETTINGS_BY_CODE: Record<string, HumiditySetting> =
  Object.fromEntries(
    Object.entries(HUMIDITY_SETTING_CODES).map(([setting, code]) => [
      code,
      setting as HumiditySetting,
    ]),
  );

// `adv` holds one code for each special mode that is on, separated by `/`.
const SPECIAL_MODE_ADV_CODES: Record<SpecialMode, string> = {
  powerful: "2",
  econo: "12",
  streamer: "13",
};

// Fan mode keeps no setpoint memory, and dehumidify runs the fan on auto only.
const NO_SETPOINT = "--";
const DEHUMIDIFY_FAN_SPEED = "A";
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
 * `dfd` and, for the louvers, `ndfd`. `capabilityFields`, the field map of
 * `mergeClassicCapabilityFields`, says which fields the unit takes: `shum`
 * unless it is `subtype=qa`, `f_dir_ud` and `f_dir_lr` on a 3D unit
 * (`en_fdir2`), and `f_dir` on a unit that takes a direction. It drops a
 * `targetTemperatureInC` in dehumidify, writes `mode=0` and `mode=7` as
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
      : OPERATING_MODE_CODES[heldMode];
  const mode =
    control.mode === undefined
      ? currentMode
      : OPERATING_MODE_CODES[control.mode];
  const modeChanged = mode !== currentMode;
  const remembered = (field: string, memoryPrefix: string) =>
    (modeChanged ? current[`${memoryPrefix}${mode}`] : undefined) ??
    current[field] ??
    "";

  const power = control.power ?? current.pow === "1";
  const next: Record<string, string> = { pow: power ? "1" : "0", mode };

  const setpointFrozen = mode === OPERATING_MODE_CODES.fan;
  // Only a mode in the model has a `dt` and a `dh` memory.
  const hasMemory =
    !setpointFrozen && (control.mode !== undefined || heldMode !== undefined);
  next.stemp = setpointFrozen
    ? NO_SETPOINT
    : control.targetTemperatureInC != null &&
        mode !== OPERATING_MODE_CODES.dehumidify
      ? control.targetTemperatureInC.toFixed(1)
      : remembered("stemp", "dt");
  if (hasMemory) {
    next[`dt${mode}`] = next.stemp;
  }
  if (takesClassicHumidity(capabilityFields)) {
    next.shum = setpointFrozen
      ? NO_SETPOINT
      : control.targetHumidity != null
        ? encodeTargetHumidity(control.targetHumidity)
        : remembered("shum", "dh");
    if (hasMemory) {
      next[`dh${mode}`] = next.shum;
    }
  }

  next.f_rate =
    mode === OPERATING_MODE_CODES.dehumidify
      ? DEHUMIDIFY_FAN_SPEED
      : control.fanSpeed === undefined
        ? remembered("f_rate", "dfr")
        : FAN_SPEED_CODES[control.fanSpeed];

  if (capabilityFields.en_fdir2 === "1") {
    // `ndfd<mode>` holds the mode's `f_dir_ud` value, then its `f_dir_lr`
    // value. A value outside the model is sent back as it came.
    const louverMemory = modeChanged ? current[`ndfd${mode}`] : undefined;
    let vertical =
      rememberedLouver(louverMemory, 0) || current.f_dir_ud || LOUVER_STOP;
    let horizontal =
      rememberedLouver(louverMemory, 1) || current.f_dir_lr || LOUVER_STOP;
    if (control.swingMode !== undefined) {
      const swingsVertically =
        control.swingMode === "vertical" || control.swingMode === "both";
      const swingsHorizontally =
        control.swingMode === "horizontal" || control.swingMode === "both";
      vertical = swingsVertically
        ? LOUVER_SWING
        : vertical === LOUVER_SWING
          ? LOUVER_STOP
          : vertical;
      horizontal = swingsHorizontally
        ? LOUVER_SWING
        : horizontal === LOUVER_SWING
          ? LOUVER_STOP
          : horizontal;
    }
    if (control.verticalPosition != null) {
      vertical = VERTICAL_POSITION_CODES[control.verticalPosition];
    }
    if (control.horizontalPosition != null) {
      horizontal = HORIZONTAL_POSITION_CODES[control.horizontalPosition];
    }
    next.f_dir_ud = vertical;
    next.f_dir_lr = horizontal;
    if (takesDirection) {
      next.f_dir = String(
        (vertical === LOUVER_SWING ? 1 : 0) |
          (horizontal === LOUVER_SWING ? 2 : 0),
      );
    }
  } else if (takesDirection) {
    next.f_dir =
      control.swingMode === undefined
        ? remembered("f_dir", "dfd")
        : SWING_MODE_CODES[control.swingMode];
  }
  return next;
}

function parseSpecialModes(adv: string | undefined): SpecialMode[] {
  const codes = (adv ?? "").split("/");
  return SPECIAL_MODES.filter((mode) =>
    codes.includes(SPECIAL_MODE_ADV_CODES[mode]),
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
    ? HUMIDITY_SETTING_CODES[targetHumidity]
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
