import type {
  DaikinCapabilities,
  TemperatureRange,
} from "../../models/capabilities.js";
import {
  type FanSpeed,
  OPERATING_MODES,
  type OperatingMode,
  SWING_MODES,
} from "../../models/state.js";

const ALWAYS_OFFERED_MODES: readonly OperatingMode[] = ["cool", "heat", "fan"];
const THREE_FAN_LEVELS: FanSpeed[] = ["level1", "level3", "level5"];
const TWO_FAN_LEVELS: FanSpeed[] = ["level1", "level5"];

/** Merges the `basic_info` and `get_model_info` replies of an Airbase adapter
 * into the one field map `parseAirbaseCapabilities`, `takesAirbaseFanAuto`,
 * `takesAirbaseAirside` and `parseAirbaseZones` read. */
export function mergeAirbaseCapabilityFields(
  basicInfo: Record<string, string>,
  modelInfo: Record<string, string>,
): Record<string, string> {
  return { ...basicInfo, ...modelInfo };
}

/** Turns the field map from `mergeAirbaseCapabilityFields` into
 * `DaikinCapabilities`. A unit with zones (`en_zone`) takes no `auto` fan
 * speed and no direction. It lists no humidity setting, louver position or
 * special mode, and reports `energyMonitoring` and `demandControl` as
 * `false`: which field says a unit has either is not known. */
export function parseAirbaseCapabilities(
  fields: Record<string, string>,
): DaikinCapabilities {
  const offeredModes = OPERATING_MODES.filter(
    (mode) =>
      ALWAYS_OFFERED_MODES.includes(mode) ||
      (mode === "auto" && fields.en_auto === "1") ||
      (mode === "dehumidify" && fields.en_dry === "1"),
  );
  const offered = (mode: OperatingMode, range: TemperatureRange) =>
    offeredModes.includes(mode) ? range : null;
  const none = { auto: [], dehumidify: [], cool: [], heat: [], fan: [] };

  return {
    modes: offeredModes,
    fanSpeeds: fanSpeeds(fields),
    swingModes:
      !hasZones(fields) && fields.en_fdir === "1" ? [...SWING_MODES] : [],
    verticalPositions: [],
    horizontalPositions: [],
    targetTemperaturesInC: {
      // Auto runs from the lowest setpoint of cool to the highest of heat.
      auto: offered("auto", range(fields.cool_l, 18, fields.heat_h, 30)),
      cool: offered("cool", range(fields.cool_l, 18, fields.cool_h, 32)),
      heat: offered("heat", range(fields.heat_l, 10, fields.heat_h, 30)),
      dehumidify: null,
      fan: null,
    },
    targetHumidities: none,
    specialModes: none,
    specialOutlet: false,
    energyMonitoring: false,
    demandControl: false,
    scheduleTimer: ["1", "2"].includes(fields.en_scdltmr ?? ""),
    model: fields.model,
  };
}

/** Whether a unit takes fan auto, read from the field map of
 * `mergeAirbaseCapabilityFields`: one with zones that counts its fan speeds
 * (`frate_steps`), unless `en_frate_auto` is 0. */
export function takesAirbaseFanAuto(fields: Record<string, string>): boolean {
  return (
    isFanControllable(fields) &&
    hasZones(fields) &&
    fanLevels(fields).length > 0 &&
    "frate_steps" in fields &&
    (fields.en_frate_auto ?? "1") === "1"
  );
}

/** Whether a unit takes airside, read from the field map of
 * `mergeAirbaseCapabilityFields`: one with zones that reports
 * `en_airside=1`. */
export function takesAirbaseAirside(fields: Record<string, string>): boolean {
  return (
    isFanControllable(fields) && hasZones(fields) && fields.en_airside === "1"
  );
}

/** How many zones a unit has, read from the field map of
 * `mergeAirbaseCapabilityFields`: `en_zone`, and none without it. */
export function parseAirbaseZoneCount(fields: Record<string, string>): number {
  const count = Number.parseInt(fields.en_zone ?? "", 10);
  return count > 0 ? count : 0;
}

function hasZones(fields: Record<string, string>): boolean {
  return "en_zone" in fields && fields.en_zone !== "0";
}

// A unit that sets each zone's airflow itself (`en_linear_zone=1`) takes no
// fan speed.
function isFanControllable(fields: Record<string, string>): boolean {
  return (
    (fields.reg ?? "") !== "" &&
    fields.reg !== "jp" &&
    fields.en_frate === "1" &&
    fields.en_linear_zone !== "1"
  );
}

// Three levels unless `frate_steps` is 2, and none when it is not a number.
function fanLevels(fields: Record<string, string>): FanSpeed[] {
  if (!("frate_steps" in fields)) {
    return THREE_FAN_LEVELS;
  }
  const steps = Number.parseInt(fields.frate_steps ?? "", 10);
  if (!Number.isFinite(steps)) {
    return [];
  }
  return steps === 2 ? TWO_FAN_LEVELS : THREE_FAN_LEVELS;
}

function fanSpeeds(fields: Record<string, string>): FanSpeed[] {
  if (!isFanControllable(fields)) {
    return [];
  }
  const takesAuto = !hasZones(fields) && fields.en_frate_auto === "1";
  return [...(takesAuto ? (["auto"] as const) : []), ...fanLevels(fields)];
}

// Setpoint limits are whole °C on the wire; any fraction is dropped.
function range(
  low: string | undefined,
  fallbackMin: number,
  high: string | undefined,
  fallbackMax: number,
): TemperatureRange {
  return {
    min: wholeCelsius(low, fallbackMin),
    max: wholeCelsius(high, fallbackMax),
    step: 1,
  };
}

function wholeCelsius(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
