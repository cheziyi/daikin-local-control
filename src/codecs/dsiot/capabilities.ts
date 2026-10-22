import type {
  DaikinCapabilities,
  TemperatureRange,
} from "../../models/capabilities.js";
import {
  FAN_SPEEDS,
  type FanSpeed,
  FIXED_LOUVER_POSITIONS,
  HORIZONTAL_POSITIONS,
  type HorizontalPosition,
  HUMIDITY_SETTINGS,
  OPERATING_MODES,
  type OperatingMode,
  SPECIAL_MODES,
  SWING_MODES,
  type SwingMode,
  VERTICAL_POSITIONS,
  type VerticalPosition,
} from "../../models/state.js";
import { decodeDsiotLittleEndian } from "./state.js";
import {
  DSIOT_ADAPTER_PATHS,
  DSIOT_COOLING_ONLY_MODEL_TYPE,
  DSIOT_HORIZONTAL_POSITION_VALUES,
  DSIOT_MODE_PATHS,
  DSIOT_PATHS,
  DSIOT_SPECIAL_MODE_PATHS,
  DSIOT_VERTICAL_POSITION_VALUES,
  type DsiotSetpoint,
} from "./tables.js";

const MODE_PATHS = Object.values(DSIOT_MODE_PATHS);

// The `pt` of a special mode's leaf on a unit that takes the mode.
const SPECIAL_MODE_OFFERED_TYPE = "2";

const COOLING_ONLY_MODES: readonly OperatingMode[] = [
  "dehumidify",
  "cool",
  "fan",
];

// The fixed positions, 1-14, in a louver leaf's `md.mx`.
const FIXED_LOUVER_MASK = 0x7ffe;
const FIXED_POSITIONS: readonly string[] = FIXED_LOUVER_POSITIONS;

type LouverAxis = "vertical" | "horizontal";

/** Turns the flattened `adp_i` tree and the indoor and outdoor `dgc_status`
 * trees (with `pt` and `md`) into `DaikinCapabilities`. Setpoints count half
 * degrees, and the auto range caps at 30 °C whatever its `md.mx` says.
 * Without the outdoor tree, `specialModes` lists no `powerful`. It lists
 * econo in every mode but fan: see UNSUPPORTED.md. */
export function parseDsiotCapabilities(
  values: Record<string, string>,
): DaikinCapabilities {
  const modes =
    values[DSIOT_PATHS.modelType] === DSIOT_COOLING_ONLY_MODEL_TYPE
      ? [...COOLING_ONLY_MODES]
      : [...OPERATING_MODES];
  const offered = (mode: OperatingMode, range: TemperatureRange) =>
    modes.includes(mode) ? range : null;
  // A mode takes a humidity setting when the unit reports the mode's flag.
  const humiditySettings = (mode: OperatingMode) => {
    const flag = DSIOT_MODE_PATHS[mode].humidity?.flag;
    return modes.includes(mode) && flag !== undefined && flag in values
      ? [...HUMIDITY_SETTINGS]
      : [];
  };
  const takenSpecialModes = SPECIAL_MODES.filter(
    (specialMode) =>
      values[`${DSIOT_SPECIAL_MODE_PATHS[specialMode]}.pt`] ===
      SPECIAL_MODE_OFFERED_TYPE,
  );
  const specialModes = (mode: OperatingMode) =>
    modes.includes(mode)
      ? takenSpecialModes.filter(
          (specialMode) => mode !== "fan" || specialMode !== "econo",
        )
      : [];
  const vertical = hasLouver(values, "vertical");
  const horizontal = hasLouver(values, "horizontal");
  const energyMonitoring =
    values[DSIOT_ADAPTER_PATHS.energyMonitoring] === "1" &&
    values[DSIOT_PATHS.energyMonitoring] === "01";

  return {
    modes,
    fanSpeeds: fanSpeeds(values),
    swingModes: swingModes(vertical, horizontal),
    verticalPositions: vertical
      ? verticalPositions(louverMask(values, "vertical"))
      : [],
    horizontalPositions: horizontal
      ? horizontalPositions(louverMask(values, "horizontal"))
      : [],
    targetTemperaturesInC: {
      auto: offered(
        "auto",
        range(values, DSIOT_MODE_PATHS.auto.setpoint, 18, 30),
      ),
      cool: offered(
        "cool",
        range(values, DSIOT_MODE_PATHS.cool.setpoint, 18, 32),
      ),
      heat: offered(
        "heat",
        range(values, DSIOT_MODE_PATHS.heat.setpoint, 10, 30),
      ),
      dehumidify: null,
      fan: null,
    },
    targetHumidities: {
      auto: humiditySettings("auto"),
      // Dehumidify takes no off.
      dehumidify: humiditySettings("dehumidify").filter(
        (setting) => setting !== "off",
      ),
      cool: humiditySettings("cool"),
      heat: humiditySettings("heat"),
      fan: [],
    },
    specialModes: {
      auto: specialModes("auto"),
      dehumidify: specialModes("dehumidify"),
      cool: specialModes("cool"),
      heat: specialModes("heat"),
      fan: specialModes("fan"),
    },
    specialOutlet: hasSpecialOutlet(values[DSIOT_PATHS.specialOutlet]),
    energyMonitoring,
    demandControl:
      energyMonitoring &&
      values[DSIOT_ADAPTER_PATHS.kind] === "4" &&
      values[DSIOT_ADAPTER_PATHS.demandControl] === "1",
    scheduleTimer: ["1", "2"].includes(
      values[DSIOT_ADAPTER_PATHS.scheduleTimer] ?? "",
    ),
    model: values[DSIOT_PATHS.model],
  };
}

// The leaf holds 0 on a unit with the outlet, read as a decimal: a hex value
// such as `0A` is not one.
function hasSpecialOutlet(pv: string | undefined): boolean {
  return pv !== undefined && pv !== "" && Number(pv) === 0;
}

function hasLouver(values: Record<string, string>, axis: LouverAxis): boolean {
  return MODE_PATHS.some((paths) => paths[axis] in values);
}

// Every value the unit takes on an axis in any mode, as `md.mx` bits.
function louverMask(values: Record<string, string>, axis: LouverAxis): number {
  return MODE_PATHS.reduce(
    (mask, paths) =>
      mask | decodeDsiotLittleEndian(values[`${paths[axis]}.md.mx`] ?? ""),
    0,
  );
}

function takes(mask: number, value: number | undefined): boolean {
  return value !== undefined && (mask & (1 << value)) !== 0;
}

// Japanese units (`jp`) follow other rules: see UNSUPPORTED.md.
function fanSpeeds(values: Record<string, string>): FanSpeed[] {
  const region = values[DSIOT_ADAPTER_PATHS.region];
  if (!region || region === "jp") {
    return [];
  }
  return MODE_PATHS.some(({ fanSpeed }) => fanSpeed in values)
    ? [...FAN_SPEEDS]
    : [];
}

function swingModes(vertical: boolean, horizontal: boolean): SwingMode[] {
  if (vertical && horizontal) {
    return [...SWING_MODES];
  }
  if (vertical) {
    return ["off", "vertical"];
  }
  return horizontal ? ["off", "horizontal"] : [];
}

// A unit that takes n fixed values offers the first n fixed positions, as
// `parseDsiotState` names them by rank.
function verticalPositions(mask: number): VerticalPosition[] {
  // Without `md.mx` the unit takes stop alone.
  if (mask === 0) {
    return ["stop"];
  }
  const fixedCount = bitCount(mask & FIXED_LOUVER_MASK);
  return VERTICAL_POSITIONS.filter((position) => {
    const rank = FIXED_POSITIONS.indexOf(position);
    return rank === -1
      ? takes(mask, DSIOT_VERTICAL_POSITION_VALUES[position])
      : rank < fixedCount;
  });
}

// `parseDsiotState` reads a fixed position as `stop`, so stop is always
// offered: see UNSUPPORTED.md.
function horizontalPositions(mask: number): HorizontalPosition[] {
  return HORIZONTAL_POSITIONS.filter(
    (position) =>
      position === "stop" ||
      takes(mask, DSIOT_HORIZONTAL_POSITION_VALUES[position]),
  );
}

function bitCount(mask: number): number {
  return mask.toString(2).replaceAll("0", "").length;
}

// A setpoint's `md.mi` and `md.mx` count half degrees. Without both, the range
// is `fallbackMin` to `ceiling`, and `ceiling` caps the unit's own maximum.
function range(
  values: Record<string, string>,
  setpoint: DsiotSetpoint | undefined,
  fallbackMin: number,
  ceiling: number,
): TemperatureRange {
  const min =
    decodeDsiotLittleEndian(values[`${setpoint?.path}.md.mi`] ?? "") / 2;
  const max =
    decodeDsiotLittleEndian(values[`${setpoint?.path}.md.mx`] ?? "") / 2;
  const reported = Number.isFinite(min) && Number.isFinite(max);
  return {
    min: reported ? min : fallbackMin,
    max: reported ? Math.min(max, ceiling) : ceiling,
    step: 0.5,
  };
}
