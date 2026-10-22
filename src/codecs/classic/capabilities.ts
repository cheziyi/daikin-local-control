import type {
  DaikinCapabilities,
  TemperatureRange,
} from "../../models/capabilities.js";
import {
  type FanSpeed,
  FIXED_LOUVER_POSITIONS,
  type HorizontalPosition,
  HUMIDITY_SETTINGS,
  OPERATING_MODES,
  type OperatingMode,
  SPECIAL_MODES,
  type SpecialMode,
  SWING_MODES,
  type SwingMode,
  type TargetHumidity,
  type VerticalPosition,
} from "../../models/state.js";
import {
  CLASSIC_CAPABILITY_VERSIONS,
  CLASSIC_COOLING_ONLY_TYPE,
  CLASSIC_DEFAULT_REGION,
  CLASSIC_FAN_LEVELS_BY_STEPS,
  CLASSIC_HUMIDITY_MODE_BITS,
  CLASSIC_SPECIAL_MODE_BITS,
  CLASSIC_SWING_AXES_CODES,
} from "./tables.js";

const COOLING_ONLY_MODES: readonly OperatingMode[] = [
  "cool",
  "dehumidify",
  "fan",
];
const VERTICAL_SWING_MODES: SwingMode[] = ["off", "vertical"];
// Dehumidify takes no off.
const DEHUMIDIFY_HUMIDITY_SETTINGS = HUMIDITY_SETTINGS.filter(
  (setting) => setting !== "off",
);

/** Merges the `basic_info` and `get_model_info` replies into the one field map
 * `parseClassicCapabilities` and `applyClassicControl` read. Both replies
 * carry a `type` (the adapter's and the unit's), so they are renamed
 * to `basic_type` and `model_type` before merging; cooling-only detection
 * reads `model_type`. */
export function mergeClassicCapabilityFields(
  basicInfo: Record<string, string>,
  modelInfo: Record<string, string>,
): Record<string, string> {
  const { type: basicType, ...basic } = basicInfo;
  const { type: modelType, ...model } = modelInfo;
  return {
    ...basic,
    ...model,
    ...(basicType === undefined ? {} : { basic_type: basicType }),
    ...(modelType === undefined ? {} : { model_type: modelType }),
  };
}

/** Turns the field map from `mergeClassicCapabilityFields` into
 * `DaikinCapabilities`. `cpv` (capability-protocol version) is the master
 * branch. A unit that reports no `reg` is read as one sold for `th`, and a
 * `reg` is read whatever its letter case. Units for Japan (`reg=jp`) follow
 * other rules, which this package does not model. */
export function parseClassicCapabilities(
  fields: Record<string, string>,
): DaikinCapabilities {
  const cpv = fields.cpv ?? "";
  const modern = cpv === "2" || cpv === "3";
  const threeD = fields.en_fdir2 === "1";
  const offeredModes = modes(fields, cpv);
  const offered = (mode: OperatingMode, range: TemperatureRange) =>
    offeredModes.includes(mode) ? range : null;

  return {
    modes: offeredModes,
    fanSpeeds: fanSpeeds(fields, modern),
    swingModes: swingModes(fields),
    verticalPositions: threeD ? verticalPositions(fields) : [],
    horizontalPositions: threeD ? horizontalPositions(fields) : [],
    targetTemperaturesInC: {
      // Only `subtype=qa` units report an auto range; the rest are fixed.
      auto: offered(
        "auto",
        fields.subtype === "qa"
          ? range(fields.hmlmt_l, 18, fields.cmlmt_h, 30)
          : range(undefined, 18, undefined, 30),
      ),
      cool: offered("cool", range(fields.cmlmt_l, 18, fields.cmlmt_h, 32)),
      heat: offered("heat", range(fields.hmlmt_l, 10, fields.hmlmt_h, 30)),
      dehumidify: null,
      fan: null,
    },
    targetHumidities: targetHumidities(fields, modern, offeredModes),
    specialModes: specialModes(fields, cpv, offeredModes),
    specialOutlet: cpv === "3" && fields.airoutlet_pv === "0",
    energyMonitoring: fields.elec === "1",
    demandControl: fields.adp_kind === "4" && fields.dmnd === "1",
    scheduleTimer: ["1", "2"].includes(fields.en_scdltmr ?? ""),
    model: fields.model,
  };
}

// Lists none for a unit that reports no `en_spmode`, and econo in every mode
// but fan. The powerful and econo bits count only at `cpv=3` with a
// `cpv_minor` other than `00`: see UNSUPPORTED.md.
function specialModes(
  fields: Record<string, string>,
  cpv: string,
  offeredModes: OperatingMode[],
): Record<OperatingMode, SpecialMode[]> {
  const bits = Number.parseInt(fields.en_spmode ?? "", 10);
  const followsPowerfulAndEcono =
    cpv === "3" && (fields.cpv_minor ?? "00") !== "00";
  const taken = SPECIAL_MODES.filter(
    (specialMode) =>
      (bits & CLASSIC_SPECIAL_MODE_BITS[specialMode]) !== 0 &&
      (specialMode === "streamer" || followsPowerfulAndEcono),
  );
  const inMode = (mode: OperatingMode) =>
    offeredModes.includes(mode)
      ? taken.filter((specialMode) => mode !== "fan" || specialMode !== "econo")
      : [];
  return {
    auto: inMode("auto"),
    dehumidify: inMode("dehumidify"),
    cool: inMode("cool"),
    heat: inMode("heat"),
    fan: inMode("fan"),
  };
}

function present(fields: Record<string, string>, key: string): boolean {
  return (fields[key] ?? "") !== "";
}

function region(fields: Record<string, string>): string {
  return (fields.reg || CLASSIC_DEFAULT_REGION).toLowerCase();
}

function modes(fields: Record<string, string>, cpv: string): OperatingMode[] {
  if (!CLASSIC_CAPABILITY_VERSIONS.includes(cpv)) {
    return [];
  }
  return fields.model_type === CLASSIC_COOLING_ONLY_TYPE
    ? OPERATING_MODES.filter((mode) => COOLING_ONLY_MODES.includes(mode))
    : [...OPERATING_MODES];
}

function fanSpeeds(
  fields: Record<string, string>,
  modern: boolean,
): FanSpeed[] {
  if (region(fields) === "jp") {
    return [];
  }
  // A `reg=th`, `subtype=qa` unit is controllable by the speeds it lists, not
  // by `en_frate`, but from cpv 2 it lists none without `en_frate=1`.
  const listsItsSpeeds =
    region(fields) === CLASSIC_DEFAULT_REGION && fields.subtype === "qa";
  if ((!listsItsSpeeds || modern) && fields.en_frate !== "1") {
    return [];
  }
  const speeds: FanSpeed[] = [];
  if (!("en_frate_auto" in fields) || fields.en_frate_auto === "1") {
    speeds.push("auto");
  }
  if (
    modern &&
    (!present(fields, "en_frate_silent") || fields.en_frate_silent === "1")
  ) {
    speeds.push("silent");
  }
  const levels =
    CLASSIC_FAN_LEVELS_BY_STEPS[
      "frate_steps" in fields ? (fields.frate_steps ?? "") : "5"
    ] ?? [];
  return [...speeds, ...levels];
}

/** Whether a unit's `set_control_info` takes `shum`, read from the field map
 * of `mergeClassicCapabilityFields`. A `subtype=qa` unit takes none. */
export function takesClassicHumidity(fields: Record<string, string>): boolean {
  return fields.subtype !== "qa";
}

function targetHumidities(
  fields: Record<string, string>,
  modern: boolean,
  offeredModes: OperatingMode[],
): Record<OperatingMode, TargetHumidity[]> {
  const mask =
    modern && takesClassicHumidity(fields)
      ? Number.parseInt(fields.s_humd ?? "", 10)
      : 0;
  const settings = (
    mode: keyof typeof CLASSIC_HUMIDITY_MODE_BITS,
    values: TargetHumidity[],
  ) =>
    offeredModes.includes(mode) && mask & CLASSIC_HUMIDITY_MODE_BITS[mode]
      ? values
      : [];
  return {
    auto: settings("auto", [...HUMIDITY_SETTINGS]),
    dehumidify: settings("dehumidify", DEHUMIDIFY_HUMIDITY_SETTINGS),
    cool: settings("cool", [...HUMIDITY_SETTINGS]),
    heat: settings("heat", [...HUMIDITY_SETTINGS]),
    fan: [],
  };
}

// A unit that takes `f_dir` swings vertically only when `s_fdir=1`; a 3D unit
// without `f_dir` swings through `f_dir_ud`/`f_dir_lr` on both axes.
function swingModes(fields: Record<string, string>): SwingMode[] {
  if (takesClassicDirection(fields)) {
    return fields.s_fdir === CLASSIC_SWING_AXES_CODES.vertical
      ? VERTICAL_SWING_MODES
      : [...SWING_MODES];
  }
  return fields.en_fdir2 === "1" ? [...SWING_MODES] : [];
}

/** Whether a unit's `set_control_info` takes `f_dir`, read from the field map
 * of `mergeClassicCapabilityFields`. */
export function takesClassicDirection(fields: Record<string, string>): boolean {
  if (fields.subtype === "qa") {
    return fields.s_fdir === CLASSIC_SWING_AXES_CODES.vertical;
  }
  const cpv = fields.cpv;
  if (cpv === "0" || cpv === "1") {
    return (
      fields.s_fdir === CLASSIC_SWING_AXES_CODES.vertical ||
      fields.s_fdir === CLASSIC_SWING_AXES_CODES.both
    );
  }
  return (cpv === "2" || cpv === "3") && fields.en_fdir === "1";
}

// `s_fdir_ud` is a hex mask: 0x01 swing, 0x10 floor warming, 0x80 the five
// fixed positions (only when `s_fdir_ud_step=5`). Stop is offered unless a
// fixed position is.
function verticalPositions(fields: Record<string, string>): VerticalPosition[] {
  const stopAndSwing: VerticalPosition[] = ["swing", "stop"];
  if (!present(fields, "s_fdir_ud")) {
    return stopAndSwing;
  }
  const mask = Number.parseInt(fields.s_fdir_ud ?? "", 16);
  if (!Number.isFinite(mask)) {
    return stopAndSwing;
  }
  const positions: VerticalPosition[] = [];
  if (mask & 0x01) {
    positions.push("swing");
  }
  if (mask & 0x10) {
    positions.push("floorWarming");
  }
  if (mask & 0x80) {
    const steps = Number.parseInt(fields.s_fdir_ud_step ?? "", 10);
    if (!(steps >= 0 && steps <= 5)) {
      return stopAndSwing;
    }
    if (steps === 5) {
      positions.push(...FIXED_LOUVER_POSITIONS);
    }
  }
  if (
    positions.length === 0 ||
    (positions.length === 1 && positions[0] === "swing")
  ) {
    positions.push("stop");
  }
  return positions;
}

// `s_fdir_lr` bit 0x01 is swing; stop is always offered.
function horizontalPositions(
  fields: Record<string, string>,
): HorizontalPosition[] {
  const mask = Number.parseInt(fields.s_fdir_lr ?? "", 16);
  return Number.isFinite(mask) && mask & 0x01 ? ["stop", "swing"] : ["stop"];
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
