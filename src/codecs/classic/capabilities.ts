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

const CAPABILITY_VERSIONS = ["0", "1", "2", "3"];
// `en_spmode` sets one bit for each special mode the unit takes. Bit 8 is a
// mode outside `SpecialMode`.
const SPECIAL_MODE_BITS: Record<SpecialMode, number> = {
  powerful: 1,
  econo: 2,
  streamer: 4,
};
const COOLING_ONLY_MODES: readonly OperatingMode[] = [
  "cool",
  "dehumidify",
  "fan",
];
const VERTICAL_SWING_MODES: SwingMode[] = ["off", "vertical"];
const ALL_FAN_LEVELS: FanSpeed[] = [
  "level1",
  "level2",
  "level3",
  "level4",
  "level5",
];
const FAN_LEVELS_BY_STEPS: Record<string, FanSpeed[]> = {
  "2": ["level1", "level5"],
  "3": ["level1", "level3", "level5"],
  "5": ALL_FAN_LEVELS,
};
// `s_humd` is a decimal mask with one bit for each mode that takes a humidity
// setting.
const HUMIDITY_MODE_BITS = {
  auto: 0x01,
  cool: 0x02,
  heat: 0x04,
  dehumidify: 0x10,
} as const;
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
 * branch. Units for Japan (`reg=jp`) follow other rules, which this package
 * does not model. */
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
    specialModes: specialModes(fields.en_spmode),
    specialOutlet: cpv === "3" && fields.airoutlet_pv === "0",
    energyMonitoring: fields.elec === "1",
    demandControl: fields.adp_kind === "4" && fields.dmnd === "1",
    scheduleTimer: ["1", "2"].includes(fields.en_scdltmr ?? ""),
    model: fields.model,
  };
}

// A unit that reports no `en_spmode` lists none.
function specialModes(enSpmode: string | undefined): SpecialMode[] {
  const bits = Number.parseInt(enSpmode ?? "", 10);
  return SPECIAL_MODES.filter((mode) => (bits & SPECIAL_MODE_BITS[mode]) !== 0);
}

function present(fields: Record<string, string>, key: string): boolean {
  return (fields[key] ?? "") !== "";
}

function modes(fields: Record<string, string>, cpv: string): OperatingMode[] {
  if (!CAPABILITY_VERSIONS.includes(cpv)) {
    return [];
  }
  return fields.model_type === "C"
    ? OPERATING_MODES.filter((mode) => COOLING_ONLY_MODES.includes(mode))
    : [...OPERATING_MODES];
}

function fanSpeeds(
  fields: Record<string, string>,
  modern: boolean,
): FanSpeed[] {
  if (!present(fields, "reg") || fields.reg === "jp") {
    return [];
  }
  // A `reg=th`, `subtype=qa` unit is controllable by the speeds it lists, not
  // by `en_frate`.
  const listsItsSpeeds = fields.reg === "th" && fields.subtype === "qa";
  if (!listsItsSpeeds && fields.en_frate !== "1") {
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
    "frate_steps" in fields
      ? (FAN_LEVELS_BY_STEPS[fields.frate_steps ?? ""] ?? [])
      : ALL_FAN_LEVELS;
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
    mode: keyof typeof HUMIDITY_MODE_BITS,
    values: TargetHumidity[],
  ) =>
    offeredModes.includes(mode) && mask & HUMIDITY_MODE_BITS[mode]
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
    return fields.s_fdir === "1" ? VERTICAL_SWING_MODES : [...SWING_MODES];
  }
  return fields.en_fdir2 === "1" ? [...SWING_MODES] : [];
}

/** Whether a unit's `set_control_info` takes `f_dir`, read from the field map
 * of `mergeClassicCapabilityFields`. */
export function takesClassicDirection(fields: Record<string, string>): boolean {
  if (!present(fields, "reg")) {
    return false;
  }
  if (fields.subtype === "qa") {
    return fields.s_fdir === "1";
  }
  const cpv = fields.cpv;
  if (cpv === "0" || cpv === "1") {
    return fields.s_fdir === "1" || fields.s_fdir === "3";
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
