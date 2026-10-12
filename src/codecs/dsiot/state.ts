import {
  type DaikinControl,
  type DaikinSensors,
  type DaikinState,
  type FanSpeed,
  FIXED_LOUVER_POSITIONS,
  HORIZONTAL_POSITIONS,
  type HorizontalPosition,
  type HumiditySetting,
  type OperatingMode,
  SPECIAL_MODES,
  type SpecialMode,
  type SwingMode,
  type TargetHumidity,
  VERTICAL_POSITIONS,
  type VerticalPosition,
} from "../../models/state.js";
import type { DsiotUpdate } from "./multireq.js";

/** Full dotted paths into the `dgc_status` trees. `e_1002` lives on the indoor
 * edge and `e_1003` on the outdoor edge. */
export const DSIOT_PATHS = {
  power: "dgc_status.e_1002.e_A002.p_01",
  /** Sent with every control. */
  powerTransition: "dgc_status.e_1002.e_3003.p_2D",
  mode: "dgc_status.e_1002.e_3001.p_01",
  indoorTemperature: "dgc_status.e_1002.e_A00B.p_01",
  indoorHumidity: "dgc_status.e_1002.e_A00B.p_02",
  outdoorTemperature: "dgc_status.e_1003.e_A00D.p_01",
  model: "dgc_status.e_1002.e_A001.p_0D",
  modelType: "dgc_status.e_1002.e_A001.p_07",
  energyMonitoring: "dgc_status.e_1002.e_A011.p_01",
} as const;

// Each leaf holds `01` while its mode is on. Powerful is on the outdoor edge.
const SPECIAL_MODE_PATHS: Record<SpecialMode, string> = {
  powerful: "dgc_status.e_1003.e_3002.p_44",
  econo: "dgc_status.e_1002.e_3003.p_24",
  streamer: "dgc_status.e_1002.e_3003.p_20",
};
const SPECIAL_MODE_ON = "01";

export interface DsiotSetpoint {
  path: string;
  /** Auto and dehumidify are a signed byte; cool and heat are little-endian. */
  signed: boolean;
  /** The dehumidify setpoint is read-only. */
  writable: boolean;
}

export interface DsiotHumidity {
  /** Counted in steps of the leaf's `md.st`. */
  value: string;
  /** The setting: `00` or `05` off, `01` the percentage in `value`, and one
   * value for each `HumiditySetting`. */
  flag: string;
}

export interface DsiotModePaths {
  /** Absent in fan mode. */
  setpoint?: DsiotSetpoint;
  /** Absent in fan mode. */
  humidity?: DsiotHumidity;
  fanSpeed: string;
  vertical: string;
  horizontal: string;
}

export const DSIOT_MODE_NODE = "dgc_status.e_1002.e_3001";

export const DSIOT_MODE_PATHS: Record<OperatingMode, DsiotModePaths> = {
  auto: {
    setpoint: { path: `${DSIOT_MODE_NODE}.p_1D`, signed: true, writable: true },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_2E`,
      flag: `${DSIOT_MODE_NODE}.p_2F`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_26`,
    vertical: `${DSIOT_MODE_NODE}.p_20`,
    horizontal: `${DSIOT_MODE_NODE}.p_21`,
  },
  dehumidify: {
    setpoint: {
      path: `${DSIOT_MODE_NODE}.p_1E`,
      signed: true,
      writable: false,
    },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_30`,
      flag: `${DSIOT_MODE_NODE}.p_31`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_27`,
    vertical: `${DSIOT_MODE_NODE}.p_22`,
    horizontal: `${DSIOT_MODE_NODE}.p_23`,
  },
  cool: {
    setpoint: {
      path: `${DSIOT_MODE_NODE}.p_02`,
      signed: false,
      writable: true,
    },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_0B`,
      flag: `${DSIOT_MODE_NODE}.p_0C`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_09`,
    vertical: `${DSIOT_MODE_NODE}.p_05`,
    horizontal: `${DSIOT_MODE_NODE}.p_06`,
  },
  heat: {
    setpoint: {
      path: `${DSIOT_MODE_NODE}.p_03`,
      signed: false,
      writable: true,
    },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_2C`,
      flag: `${DSIOT_MODE_NODE}.p_2D`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_0A`,
    vertical: `${DSIOT_MODE_NODE}.p_07`,
    horizontal: `${DSIOT_MODE_NODE}.p_08`,
  },
  fan: {
    fanSpeed: `${DSIOT_MODE_NODE}.p_28`,
    vertical: `${DSIOT_MODE_NODE}.p_24`,
    horizontal: `${DSIOT_MODE_NODE}.p_25`,
  },
};

// --- value encodings -------------------------------------------------------
// Leaf values are hex strings. Multi-byte values are little-endian, and
// temperatures count half degrees.

export function encodeDsiotBoolean(on: boolean): string {
  return on ? "01" : "00";
}

export function decodeDsiotBoolean(pv: string | undefined): boolean {
  return pv !== undefined && Number.parseInt(pv, 16) > 0;
}

export function decodeDsiotLittleEndian(pv: string): number {
  const bytes = pv.match(/../g) ?? [];
  return Number.parseInt(bytes.reverse().join(""), 16);
}

export function encodeDsiotSetpoint(setpointInC: number): string {
  return (Math.trunc(setpointInC * 2) & 0xff).toString(16);
}

export function decodeDsiotSetpoint(
  pv: string | undefined,
  signed: boolean,
): number | null {
  if (!pv) {
    return null;
  }
  const halfDegrees = signed ? signedByte(pv) : decodeDsiotLittleEndian(pv);
  return Number.isFinite(halfDegrees) ? halfDegrees / 2 : null;
}

/** Indoor temperature: a signed byte of whole °C. */
export function decodeDsiotIndoorTemperature(
  pv: string | undefined,
): number | null {
  return pv ? nullIfNaN(signedByte(pv)) : null;
}

/** Indoor humidity: an unsigned byte of %. */
export function decodeDsiotIndoorHumidity(
  pv: string | undefined,
): number | null {
  return pv ? nullIfNaN(Number.parseInt(pv, 16)) : null;
}

/** Outdoor temperature: a signed little-endian 16-bit count of half degrees. */
export function decodeDsiotOutdoorTemperature(
  pv: string | undefined,
): number | null {
  if (!pv) {
    return null;
  }
  const unsigned = decodeDsiotLittleEndian(pv);
  // The shift turns NaN into 0, so a value that is not hex is caught first.
  return Number.isFinite(unsigned) ? ((unsigned << 16) >> 16) / 2 : null;
}

function signedByte(pv: string): number {
  const byte = Number.parseInt(pv.slice(0, 2), 16);
  return byte > 0x7f ? byte - 0x100 : byte;
}

function nullIfNaN(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

const OPERATING_MODE_CODES: Record<OperatingMode, string> = {
  fan: "0000",
  heat: "0100",
  cool: "0200",
  auto: "0300",
  dehumidify: "0500",
};

const OPERATING_MODES_BY_CODE: Record<string, OperatingMode> = {
  "0000": "fan",
  "0100": "heat",
  "0200": "cool",
  "0300": "auto",
  "0500": "dehumidify",
  "0900": "cool",
  "0A00": "heat",
};

export function encodeDsiotMode(mode: OperatingMode): string {
  return OPERATING_MODE_CODES[mode];
}

export function decodeDsiotMode(
  pv: string | undefined,
): OperatingMode | undefined {
  return OPERATING_MODES_BY_CODE[(pv ?? "").toUpperCase()];
}

const FAN_SPEED_CODES: Record<FanSpeed, string> = {
  auto: "0A00",
  silent: "0B00",
  level1: "0300",
  level2: "0400",
  level3: "0500",
  level4: "0600",
  level5: "0700",
};

const FAN_SPEEDS_BY_CODE: Record<string, FanSpeed> = Object.fromEntries(
  Object.entries(FAN_SPEED_CODES).map(([speed, code]) => [
    code,
    speed as FanSpeed,
  ]),
);

export function encodeDsiotFanSpeed(speed: FanSpeed): string {
  return FAN_SPEED_CODES[speed];
}

export function decodeDsiotFanSpeed(
  pv: string | undefined,
): FanSpeed | undefined {
  return FAN_SPEEDS_BY_CODE[(pv ?? "").toUpperCase()];
}

/** The values a louver leaf holds besides a fixed position, which is 1-14.
 * The leaf is three bytes, little-endian, and bit n of its `md.mx` is set
 * when the unit takes value n. */
export const DSIOT_LOUVER_VALUES = {
  stop: 0,
  swing: 15,
  auto: 16,
  naturalWind: 19,
  floorWarming: 25,
} as const;

const FIXED_LOUVER_VALUES = Array.from({ length: 14 }, (_, index) => index + 1);

export const DSIOT_LOUVER_STOP = "000000";
export const DSIOT_LOUVER_SWING = "0F0000";

export function isDsiotLouverSwinging(pv: string | undefined): boolean {
  return (pv ?? "").toUpperCase() === DSIOT_LOUVER_SWING;
}

/** The value each `VerticalPosition` is held as. A fixed position has none: it
 * is held as the value at its rank among the fixed values the unit takes. */
export const DSIOT_VERTICAL_POSITION_VALUES: Partial<
  Record<VerticalPosition, number>
> = {
  stop: DSIOT_LOUVER_VALUES.stop,
  swing: DSIOT_LOUVER_VALUES.swing,
  naturalWind: DSIOT_LOUVER_VALUES.naturalWind,
  auto: DSIOT_LOUVER_VALUES.auto,
  floorWarming: DSIOT_LOUVER_VALUES.floorWarming,
};
const FIXED_VERTICAL_POSITIONS: readonly VerticalPosition[] =
  FIXED_LOUVER_POSITIONS;
/** The value each `HorizontalPosition` is held as. `stop` and a fixed position
 * have none: see UNSUPPORTED.md. */
export const DSIOT_HORIZONTAL_POSITION_VALUES: Partial<
  Record<HorizontalPosition, number>
> = {
  swing: DSIOT_LOUVER_VALUES.swing,
  auto: DSIOT_LOUVER_VALUES.auto,
};

function positionOf<PositionT extends string>(
  positions: readonly PositionT[],
  held: Partial<Record<PositionT, number>>,
  value: number,
): PositionT | null {
  return positions.find((position) => held[position] === value) ?? null;
}

function isFixedLouverValue(value: number): boolean {
  return value >= 1 && value <= 14;
}

function fixedLouverValues(
  values: Record<string, string>,
  path: string,
): number[] {
  const mask = decodeDsiotLittleEndian(values[`${path}.md.mx`] ?? "");
  return FIXED_LOUVER_VALUES.filter((value) => mask & (1 << value));
}

function encodeLouver(value: number): string {
  return `${value.toString(16).toUpperCase().padStart(2, "0")}0000`;
}

// A fixed vertical position is named by its rank among the values the unit
// takes: a unit taking 2, 4 and 6 reports them as `position1`, `position2` and
// `position3`. A value the unit does not list reads as `stop`.
function parseVerticalPosition(
  values: Record<string, string>,
  path: string,
): VerticalPosition | null {
  const pv = values[path];
  if (pv === undefined) {
    return null;
  }
  const value = decodeDsiotLittleEndian(pv);
  if (!isFixedLouverValue(value)) {
    return positionOf(
      VERTICAL_POSITIONS,
      DSIOT_VERTICAL_POSITION_VALUES,
      value,
    );
  }
  const rank = fixedLouverValues(values, path).indexOf(value);
  return rank === -1 ? "stop" : (FIXED_VERTICAL_POSITIONS[rank] ?? null);
}

// `undefined` for a position the unit does not take in this mode.
function encodeVerticalPosition(
  position: VerticalPosition,
  values: Record<string, string>,
  path: string,
): string | undefined {
  const rank = FIXED_VERTICAL_POSITIONS.indexOf(position);
  const value =
    rank === -1
      ? DSIOT_VERTICAL_POSITION_VALUES[position]
      : fixedLouverValues(values, path)[rank];
  return value === undefined ? undefined : encodeLouver(value);
}

// A fixed horizontal position reads as `stop`: see UNSUPPORTED.md.
function parseHorizontalPosition(
  pv: string | undefined,
): HorizontalPosition | null {
  if (pv === undefined) {
    return null;
  }
  const value = decodeDsiotLittleEndian(pv);
  return value === DSIOT_LOUVER_VALUES.stop || isFixedLouverValue(value)
    ? "stop"
    : positionOf(HORIZONTAL_POSITIONS, DSIOT_HORIZONTAL_POSITION_VALUES, value);
}

// `undefined` for a fixed position, which has no encoding: see UNSUPPORTED.md.
function encodeHorizontalPosition(
  position: HorizontalPosition,
  current: string | undefined,
): string | undefined {
  if (position === "stop") {
    // Stopping the axis keeps a fixed position it already holds.
    return current !== undefined &&
      isFixedLouverValue(decodeDsiotLittleEndian(current))
      ? current
      : DSIOT_LOUVER_STOP;
  }
  const value = DSIOT_HORIZONTAL_POSITION_VALUES[position];
  return value === undefined ? undefined : encodeLouver(value);
}

const HUMIDITY_OFF = "00";
const HUMIDITY_ON = "01";
// Also reads as off, and a control that switches humidity off leaves it.
const HUMIDITY_OFF_KEPT = "05";
const HUMIDITY_SETTING_FLAGS: Record<
  Exclude<HumiditySetting, "off">,
  string
> = {
  auto: "02",
  autoHigh: "03",
  autoLow: "04",
  continuous: "06",
};
const HUMIDITY_SETTINGS_BY_FLAG: Record<string, HumiditySetting> =
  Object.fromEntries(
    Object.entries(HUMIDITY_SETTING_FLAGS).map(([setting, flag]) => [
      flag,
      setting as HumiditySetting,
    ]),
  );

// A step (`md.st`) is one byte, in decimal: the low nibble counts, and the
// high nibble, as a signed nibble, is the power of ten that scales the count.
// A value is used as it is when its leaf has no step, or a step of zero.
function decodeStep(st: string | undefined): number {
  const byte = Number(st ?? Number.NaN);
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
    return 1;
  }
  const exponent = byte >> 4;
  return (byte & 0x0f) * 10 ** (exponent < 8 ? exponent : exponent - 16) || 1;
}

function parseTargetHumidity(
  values: Record<string, string>,
  humidity: DsiotHumidity | undefined,
): TargetHumidity | null {
  const flag = humidity && values[humidity.flag];
  if (flag === HUMIDITY_OFF || flag === HUMIDITY_OFF_KEPT) {
    return "off";
  }
  if (humidity === undefined || flag !== HUMIDITY_ON) {
    return HUMIDITY_SETTINGS_BY_FLAG[flag ?? ""] ?? null;
  }
  const count = Number.parseInt(values[humidity.value] ?? "", 16);
  return Number.isFinite(count)
    ? {
        percent: Math.trunc(
          count * decodeStep(values[`${humidity.value}.md.st`]),
        ),
      }
    : null;
}

function applyTargetHumidity(
  values: Record<string, string>,
  { value, flag }: DsiotHumidity,
  targetHumidity: TargetHumidity,
): DsiotUpdate[] {
  if (targetHumidity === "off") {
    return [
      {
        path: flag,
        value:
          values[flag] === HUMIDITY_OFF_KEPT ? HUMIDITY_OFF_KEPT : HUMIDITY_OFF,
      },
    ];
  }
  if (typeof targetHumidity === "string") {
    return [{ path: flag, value: HUMIDITY_SETTING_FLAGS[targetHumidity] }];
  }
  const count = Math.trunc(
    targetHumidity.percent / decodeStep(values[`${value}.md.st`]),
  );
  return [
    { path: flag, value: HUMIDITY_ON },
    { path: value, value: count.toString(16).toUpperCase().padStart(2, "0") },
  ];
}

// Whether the mode's humidity setting is on once the control is applied.
function isHumidityOn(
  values: Record<string, string>,
  humidity: DsiotHumidity | undefined,
  targetHumidity: TargetHumidity | null | undefined,
): boolean {
  const flag = humidity && values[humidity.flag];
  if (flag === undefined) {
    return false;
  }
  return targetHumidity == null
    ? flag !== HUMIDITY_OFF && flag !== HUMIDITY_OFF_KEPT
    : targetHumidity !== "off";
}

const POWER_TRANSITIONS = {
  turningOn: "00",
  turningOff: "01",
  unchanged: "02",
} as const;

/** Turns the flattened indoor `dgc_status` tree, read with `md`, into a
 * `DaikinState`. Every value is per mode: the setpoint, humidity, fan speed and
 * louvers each have a leaf for each mode, and the state reads the current
 * mode's. Powerful is read from the outdoor tree, and reads as off without
 * it. */
export function parseDsiotState(values: Record<string, string>): DaikinState {
  const mode = decodeDsiotMode(values[DSIOT_PATHS.mode]) ?? "auto";
  const paths = DSIOT_MODE_PATHS[mode];
  return {
    power: decodeDsiotBoolean(values[DSIOT_PATHS.power]),
    mode,
    targetTemperatureInC: paths.setpoint
      ? decodeDsiotSetpoint(values[paths.setpoint.path], paths.setpoint.signed)
      : null,
    targetHumidity: parseTargetHumidity(values, paths.humidity),
    fanSpeed: decodeDsiotFanSpeed(values[paths.fanSpeed]) ?? "auto",
    swingMode: decodeSwing(values[paths.vertical], values[paths.horizontal]),
    verticalPosition: parseVerticalPosition(values, paths.vertical),
    horizontalPosition: parseHorizontalPosition(values[paths.horizontal]),
    specialModes: SPECIAL_MODES.filter(
      (mode) => values[SPECIAL_MODE_PATHS[mode]] === SPECIAL_MODE_ON,
    ),
  };
}

/** Turns `values`, the flattened indoor `dgc_status` tree read with `md`, and
 * a control into the leaves `buildDsiotMultireqUpdate` writes: power, its
 * transition and the mode every time, then whichever of the target mode's
 * leaves the control changes. It drops a `targetTemperatureInC` in a mode without
 * a writable setpoint, a `targetHumidity` in a mode the unit has no humidity
 * leaves for, and a louver position the unit does not take. It always writes
 * the `auto` fan speed in dehumidify, and in cool while a humidity setting is
 * on. A unit in a mode outside `OperatingMode` keeps it unless the control
 * sets one, and gets power, its transition and that mode alone. */
export function applyDsiotControl(
  values: Record<string, string>,
  control: DaikinControl,
): DsiotUpdate[] {
  const currentPower = decodeDsiotBoolean(values[DSIOT_PATHS.power]);
  const power = control.power ?? currentPower;
  const heldMode =
    control.mode === undefined
      ? (values[DSIOT_PATHS.mode] ?? encodeDsiotMode("auto"))
      : encodeDsiotMode(control.mode);
  const mode = decodeDsiotMode(heldMode);

  const updates: DsiotUpdate[] = [
    { path: DSIOT_PATHS.power, value: encodeDsiotBoolean(power) },
    {
      path: DSIOT_PATHS.powerTransition,
      value:
        power === currentPower
          ? POWER_TRANSITIONS.unchanged
          : power
            ? POWER_TRANSITIONS.turningOn
            : POWER_TRANSITIONS.turningOff,
    },
    {
      path: DSIOT_PATHS.mode,
      value: mode === undefined ? heldMode : encodeDsiotMode(mode),
    },
  ];
  // Which leaves a mode outside the model reads and writes is not known.
  if (mode === undefined) {
    return updates;
  }
  const paths = DSIOT_MODE_PATHS[mode];
  if (control.targetTemperatureInC != null && paths.setpoint?.writable) {
    updates.push({
      path: paths.setpoint.path,
      value: encodeDsiotSetpoint(control.targetTemperatureInC),
    });
  }
  if (
    control.targetHumidity != null &&
    paths.humidity &&
    paths.humidity.flag in values
  ) {
    updates.push(
      ...applyTargetHumidity(values, paths.humidity, control.targetHumidity),
    );
  }
  // Dehumidify runs the fan on auto only, and so does cool while a humidity
  // setting is on.
  if (
    mode === "dehumidify" ||
    (mode === "cool" &&
      isHumidityOn(values, paths.humidity, control.targetHumidity))
  ) {
    updates.push({ path: paths.fanSpeed, value: encodeDsiotFanSpeed("auto") });
  } else if (control.fanSpeed !== undefined) {
    updates.push({
      path: paths.fanSpeed,
      value: encodeDsiotFanSpeed(control.fanSpeed),
    });
  }
  let vertical: string | undefined;
  let horizontal: string | undefined;
  if (control.swingMode !== undefined) {
    const swingsVertically =
      control.swingMode === "vertical" || control.swingMode === "both";
    const swingsHorizontally =
      control.swingMode === "horizontal" || control.swingMode === "both";
    vertical = louver(swingsVertically, values[paths.vertical]);
    horizontal = louver(swingsHorizontally, values[paths.horizontal]);
  }
  // A position overrides the swing mode sent with it.
  if (control.verticalPosition != null) {
    vertical =
      encodeVerticalPosition(
        control.verticalPosition,
        values,
        paths.vertical,
      ) ?? vertical;
  }
  if (control.horizontalPosition != null) {
    horizontal =
      encodeHorizontalPosition(
        control.horizontalPosition,
        values[paths.horizontal],
      ) ?? horizontal;
  }
  if (vertical !== undefined) {
    updates.push({ path: paths.vertical, value: vertical });
  }
  if (horizontal !== undefined) {
    updates.push({ path: paths.horizontal, value: horizontal });
  }
  return updates;
}

export function parseDsiotSensors(
  values: Record<string, string>,
): DaikinSensors {
  return {
    indoorTemperatureInC: decodeDsiotIndoorTemperature(
      values[DSIOT_PATHS.indoorTemperature],
    ),
    indoorHumidityInPercent: decodeDsiotIndoorHumidity(
      values[DSIOT_PATHS.indoorHumidity],
    ),
    outdoorTemperatureInC: decodeDsiotOutdoorTemperature(
      values[DSIOT_PATHS.outdoorTemperature],
    ),
  };
}

function decodeSwing(
  vertical: string | undefined,
  horizontal: string | undefined,
): SwingMode {
  const swingsVertically = isDsiotLouverSwinging(vertical);
  const swingsHorizontally = isDsiotLouverSwinging(horizontal);
  if (swingsVertically && swingsHorizontally) {
    return "both";
  }
  return swingsVertically
    ? "vertical"
    : swingsHorizontally
      ? "horizontal"
      : "off";
}

// Stopping a swinging axis stops the louver; an axis already at a fixed
// position keeps it.
function louver(swing: boolean, current: string | undefined): string {
  if (swing) {
    return DSIOT_LOUVER_SWING;
  }
  return current === undefined || isDsiotLouverSwinging(current)
    ? DSIOT_LOUVER_STOP
    : current;
}
