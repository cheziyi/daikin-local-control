import type { FanSpeed, OperatingMode, SwingMode } from "../../models/state.js";

// The codes an Airbase adapter holds each value of a model as. It numbers
// the modes and the fan speeds differently from a classic adapter.

export const AIRBASE_OPERATING_MODE_CODES: Record<OperatingMode, string> = {
  fan: "0",
  heat: "1",
  cool: "2",
  auto: "3",
  dehumidify: "7",
};

export const AIRBASE_FAN_SPEED_CODES: Record<FanSpeed, string> = {
  auto: "0",
  silent: "B",
  level1: "1",
  level2: "2",
  level3: "3",
  level4: "4",
  level5: "5",
};

export const AIRBASE_SWING_MODE_CODES: Record<SwingMode, string> = {
  off: "0",
  vertical: "1",
  horizontal: "2",
  both: "3",
};

/** What `stemp` holds in a mode without a setpoint, such as dehumidify. */
export const AIRBASE_NO_SETPOINT = "--";
