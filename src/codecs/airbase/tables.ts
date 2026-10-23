import type {
  FanSpeed,
  OperatingMode,
  VerticalPosition,
} from "../../models/state.js";

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

/** The louver positions an Airbase unit holds `f_dir` at. */
export type AirbaseVerticalPosition = Extract<
  VerticalPosition,
  "position1" | "position2" | "position3" | "position4" | "position5" | "swing"
>;

/** `f_dir`: five fixed louver positions and swing, the values a unit takes as
 * a write. It reports 6 as well: see `AIRBASE_VERTICAL_POSITION_ALIASES`.
 * What 5 stands for is not known: see UNSUPPORTED.md. */
export const AIRBASE_VERTICAL_POSITION_CODES: Record<
  AirbaseVerticalPosition,
  string
> = {
  position1: "0",
  position2: "1",
  position3: "2",
  position4: "3",
  position5: "4",
  swing: "7",
};

/** The other `f_dir` value an adapter reports, and the position it reads as:
 * 6 while the louver is off. A write never sends it. */
export const AIRBASE_VERTICAL_POSITION_ALIASES: Record<
  string,
  VerticalPosition
> = {
  "6": "stop",
};

/** What `stemp` holds in a mode without a setpoint, such as dehumidify. */
export const AIRBASE_NO_SETPOINT = "--";

/** `get_zone_setting` joins each of its lists with this, form-encoded. */
export const AIRBASE_ZONE_LIST_SEPARATOR = ";";

/** The setpoint of each zone in cool and in heat, in `get_zone_setting` on a
 * unit that sets one for each zone. */
export const AIRBASE_ZONE_TEMPERATURE_FIELDS = {
  cool: "lztemp_c",
  heat: "lztemp_h",
} as const;
