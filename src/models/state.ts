// The unit's controllable state, in the package's own terms. The
// codecs map it to and from each protocol's wire encoding.

export const OPERATING_MODES = [
  "auto",
  "dehumidify",
  "cool",
  "heat",
  "fan",
] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export const FAN_SPEEDS = [
  "auto",
  "silent",
  "level1",
  "level2",
  "level3",
  "level4",
  "level5",
] as const;

export type FanSpeed = (typeof FAN_SPEEDS)[number];

export const SWING_MODES = ["off", "vertical", "horizontal", "both"] as const;

/** The axes the louvers swing on: `vertical` moves the air up and down, and
 * `horizontal` moves it left and right. A 3D unit, one with 3D airflow, also
 * reports each axis on its own, as `DaikinState.verticalPosition` and
 * `DaikinState.horizontalPosition`. */
export type SwingMode = (typeof SWING_MODES)[number];

/** The positions a louver holds still at, on either axis. */
export const FIXED_LOUVER_POSITIONS = [
  "position1",
  "position2",
  "position3",
  "position4",
  "position5",
] as const;

export const VERTICAL_POSITIONS = [
  "stop",
  ...FIXED_LOUVER_POSITIONS,
  "swing",
  "naturalWind",
  "auto",
  "floorWarming",
] as const;

/** On a DSIOT adapter, `position1` to `position5` are the first five fixed
 * positions the unit takes, in the adapter's order. */
export type VerticalPosition = (typeof VERTICAL_POSITIONS)[number];

export const HORIZONTAL_POSITIONS = [
  "stop",
  ...FIXED_LOUVER_POSITIONS,
  "swing",
  "auto",
] as const;

/** A DSIOT adapter reports a fixed position as `stop`: see UNSUPPORTED.md. */
export type HorizontalPosition = (typeof HORIZONTAL_POSITIONS)[number];

export const HUMIDITY_SETTINGS = [
  "off",
  "autoLow",
  "auto",
  "autoHigh",
  "continuous",
] as const;

/** The humidity settings that name no percentage. */
export type HumiditySetting = (typeof HUMIDITY_SETTINGS)[number];

/** A `HumiditySetting` or a percentage.
 * `DaikinCapabilities.targetHumidities` lists which of them a unit takes. */
export type TargetHumidity = HumiditySetting | { percent: number };

export const SPECIAL_MODES = ["powerful", "econo", "streamer"] as const;

export type SpecialMode = (typeof SPECIAL_MODES)[number];

export interface DaikinState {
  power: boolean;
  mode: OperatingMode;
  /** `null` in modes without a setpoint (fan, sometimes dehumidify). */
  targetTemperatureInC: number | null;
  /** `null` when the unit has no humidity setting. */
  targetHumidity: TargetHumidity | null;
  fanSpeed: FanSpeed;
  swingMode: SwingMode;
  /** On a 3D unit. `null` where the unit reports none, or one outside
   * `VerticalPosition`. */
  verticalPosition: VerticalPosition | null;
  /** On a 3D unit. `null` where the unit reports none, or one outside
   * `HorizontalPosition`. */
  horizontalPosition: HorizontalPosition | null;
  /** The special modes that are on, in the order of `SPECIAL_MODES`; empty
   * when none is. `setState` does not take it: see `DaikinControl`. */
  specialModes: SpecialMode[];
}

/** A partial `DaikinState`, as `DaikinClient.setState` takes it: set only the
 * fields to change. The client overlays the control on the state the unit
 * holds, and writes the whole state back. It drops a field the unit does not take in
 * the target mode, such as a louver position outside
 * `DaikinCapabilities.verticalPositions`. It takes no `specialModes`:
 * `DaikinClient.setSpecialMode` turns one on or off. */
export type DaikinControl = Partial<Omit<DaikinState, "specialModes">>;

/** A reading is `null` when the unit does not report it. */
export interface DaikinSensors {
  indoorTemperatureInC: number | null;
  outdoorTemperatureInC: number | null;
  indoorHumidityInPercent: number | null;
}

export interface DaikinStateAndSensors {
  state: DaikinState;
  sensors: DaikinSensors;
}
