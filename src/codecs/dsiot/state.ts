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
import { buildDsiotMultireqUpdate, type DsiotUpdate } from "./multireq.js";
import {
  DSIOT_EDGES,
  DSIOT_FAN_SPEED_CODES,
  DSIOT_FIXED_LOUVER_VALUES,
  DSIOT_HORIZONTAL_POSITION_VALUES,
  DSIOT_HUMIDITY_OFF,
  DSIOT_HUMIDITY_OFF_KEPT,
  DSIOT_HUMIDITY_PERCENTAGE,
  DSIOT_HUMIDITY_SETTING_FLAGS,
  DSIOT_LOUVER_STOP,
  DSIOT_LOUVER_SWING,
  DSIOT_LOUVER_VALUES,
  DSIOT_MODE_PATHS,
  DSIOT_OFF,
  DSIOT_ON,
  DSIOT_OPERATING_MODE_ALIASES,
  DSIOT_OPERATING_MODE_CODES,
  DSIOT_PATHS,
  DSIOT_POWER_TRANSITION_CODES,
  DSIOT_SPECIAL_MODE_PATHS,
  DSIOT_VERTICAL_POSITION_VALUES,
  type DsiotHumidity,
} from "./tables.js";

/** Builds the body of the multireq write that turns a special mode on or off:
 * its one leaf, on the outdoor edge for powerful and on the indoor edge for
 * the rest. */
export function buildDsiotSpecialModeUpdate(
  mode: SpecialMode,
  enabled: boolean,
): object {
  return buildDsiotMultireqUpdate(
    [
      {
        path: DSIOT_SPECIAL_MODE_PATHS[mode],
        value: encodeDsiotBoolean(enabled),
      },
    ],
    mode === "powerful" ? DSIOT_EDGES.outdoor : DSIOT_EDGES.indoor,
  );
}

// Leaf values are hex strings. Multi-byte values are little-endian, and
// temperatures count half degrees.

export function encodeDsiotBoolean(on: boolean): string {
  return on ? DSIOT_ON : DSIOT_OFF;
}

export function decodeDsiotBoolean(pv: string | undefined): boolean {
  return pv !== undefined && Number.parseInt(pv, 16) > 0;
}

export function decodeDsiotLittleEndian(pv: string): number {
  const bytes = pv.match(/../g) ?? [];
  return Number.parseInt(bytes.reverse().join(""), 16);
}

export function encodeDsiotSetpoint(setpointInC: number): string {
  return (Math.round(setpointInC * 2) & 0xff).toString(16);
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

const OPERATING_MODES_BY_CODE: Record<string, OperatingMode> = {
  ...Object.fromEntries(
    Object.entries(DSIOT_OPERATING_MODE_CODES).map(([mode, code]) => [
      code,
      mode as OperatingMode,
    ]),
  ),
  ...DSIOT_OPERATING_MODE_ALIASES,
};

export function encodeDsiotMode(mode: OperatingMode): string {
  return DSIOT_OPERATING_MODE_CODES[mode];
}

export function decodeDsiotMode(
  pv: string | undefined,
): OperatingMode | undefined {
  return OPERATING_MODES_BY_CODE[(pv ?? "").toUpperCase()];
}

const FAN_SPEEDS_BY_CODE: Record<string, FanSpeed> = Object.fromEntries(
  Object.entries(DSIOT_FAN_SPEED_CODES).map(([speed, code]) => [
    code,
    speed as FanSpeed,
  ]),
);

export function encodeDsiotFanSpeed(speed: FanSpeed): string {
  return DSIOT_FAN_SPEED_CODES[speed];
}

export function decodeDsiotFanSpeed(
  pv: string | undefined,
): FanSpeed | undefined {
  return FAN_SPEEDS_BY_CODE[(pv ?? "").toUpperCase()];
}

export function isDsiotLouverSwinging(pv: string | undefined): boolean {
  return (pv ?? "").toUpperCase() === DSIOT_LOUVER_SWING;
}

const FIXED_VERTICAL_POSITIONS: readonly VerticalPosition[] =
  FIXED_LOUVER_POSITIONS;
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
  return DSIOT_FIXED_LOUVER_VALUES.filter((value) => mask & (1 << value));
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

const HUMIDITY_SETTINGS_BY_FLAG: Record<string, HumiditySetting> =
  Object.fromEntries(
    Object.entries(DSIOT_HUMIDITY_SETTING_FLAGS).map(([setting, flag]) => [
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
  if (flag === DSIOT_HUMIDITY_OFF || flag === DSIOT_HUMIDITY_OFF_KEPT) {
    return "off";
  }
  if (humidity === undefined || flag !== DSIOT_HUMIDITY_PERCENTAGE) {
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
          values[flag] === DSIOT_HUMIDITY_OFF_KEPT
            ? DSIOT_HUMIDITY_OFF_KEPT
            : DSIOT_HUMIDITY_OFF,
      },
    ];
  }
  if (typeof targetHumidity === "string") {
    return [
      { path: flag, value: DSIOT_HUMIDITY_SETTING_FLAGS[targetHumidity] },
    ];
  }
  const count = Math.trunc(
    targetHumidity.percent / decodeStep(values[`${value}.md.st`]),
  );
  return [
    { path: flag, value: DSIOT_HUMIDITY_PERCENTAGE },
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
    ? flag !== DSIOT_HUMIDITY_OFF && flag !== DSIOT_HUMIDITY_OFF_KEPT
    : targetHumidity !== "off";
}

/** Turns the flattened indoor `dgc_status` tree, read with `md`, into a
 * `DaikinState`. Every value is per mode: the setpoint, humidity, fan speed and
 * louvers each have a leaf for each mode, and the state reads the current
 * mode's. Powerful is read from the outdoor tree, and reads as off without
 * it. Heat plus reads as on in heat alone. */
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
      (specialMode) =>
        values[DSIOT_SPECIAL_MODE_PATHS[specialMode]] === DSIOT_ON &&
        (specialMode !== "heatPlus" || mode === "heat"),
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
 * sets one, and gets power, its transition and that mode alone. A unit in a
 * mode of `DSIOT_OPERATING_MODE_ALIASES` keeps that value too, and gets the
 * leaves of the mode it stands for. */
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
          ? DSIOT_POWER_TRANSITION_CODES.unchanged
          : power
            ? DSIOT_POWER_TRANSITION_CODES.turningOn
            : DSIOT_POWER_TRANSITION_CODES.turningOff,
    },
    { path: DSIOT_PATHS.mode, value: heldMode },
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
