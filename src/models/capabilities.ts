import type {
  FanSpeed,
  HorizontalPosition,
  OperatingMode,
  SwingMode,
  TargetHumidity,
  VerticalPosition,
} from "./state.js";

/** In °C. */
export interface TemperatureRange {
  min: number;
  max: number;
  step: number;
}

/** What a specific unit accepts. Each control field is named for the
 * `DaikinState` field it limits and lists values in that field's own
 * vocabulary, so a caller can offer `capabilities.fanSpeeds` and send any of
 * them back as `fanSpeed`. */
export interface DaikinCapabilities {
  /** Operating modes the unit offers. */
  modes: readonly OperatingMode[];
  /** Fan speeds the unit accepts; empty when the fan is not controllable.
   * Dehumidify runs the fan on `auto` only, and so does cool on a DSIOT
   * adapter while a humidity setting is on. */
  fanSpeeds: readonly FanSpeed[];
  /** Swing settings the unit accepts; empty when airflow is not controllable. */
  swingModes: readonly SwingMode[];
  /** Vertical louver positions the unit accepts; empty unless it is a 3D
   * unit. */
  verticalPositions: readonly VerticalPosition[];
  /** Horizontal louver positions the unit accepts; empty unless it is a 3D
   * unit. */
  horizontalPositions: readonly HorizontalPosition[];
  /** Setpoint range per mode; `null` where the mode has no setpoint or the unit
   * does not offer the mode. */
  targetTemperaturesInC: Readonly<
    Record<OperatingMode, TemperatureRange | null>
  >;
  /** Humidity settings per mode; empty where the mode has none or the unit does
   * not offer it. A percentage is listed for no unit: see UNSUPPORTED.md. */
  targetHumidities: Readonly<Record<OperatingMode, readonly TargetHumidity[]>>;
  /** Whether the unit has the special air outlet, which heat can swing
   * through. That swing is not modelled: see UNSUPPORTED.md. */
  specialOutlet: boolean;
  energyMonitoring: boolean;
  demandControl: boolean;
  scheduleTimer: boolean;
  /** The adapter's own code for the unit's model: see UNSUPPORTED.md. */
  model?: string;
}
