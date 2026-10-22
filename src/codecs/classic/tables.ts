import type {
  DemandMode,
  TerminalScope,
} from "../../models/extendedControl.js";
import type {
  FanSpeed,
  HorizontalPosition,
  HumiditySetting,
  OperatingMode,
  SpecialMode,
  SwingMode,
  VerticalPosition,
} from "../../models/state.js";

// The codes a classic adapter holds each value of a model as. The codecs and
// the simulators both read them from here: see DESIGN.md#simulators.

export const CLASSIC_OPERATING_MODE_CODES: Record<OperatingMode, string> = {
  auto: "1",
  dehumidify: "2",
  cool: "3",
  heat: "4",
  fan: "6",
};

/** The other `mode` values an adapter reports, and the mode each one reads
 * as. A write sends the mode's code in `CLASSIC_OPERATING_MODE_CODES`. */
export const CLASSIC_OPERATING_MODE_ALIASES: Record<string, OperatingMode> = {
  "0": "auto",
  "7": "auto",
};

export const CLASSIC_FAN_SPEED_CODES: Record<FanSpeed, string> = {
  auto: "A",
  silent: "B",
  level1: "3",
  level2: "4",
  level3: "5",
  level4: "6",
  level5: "7",
};

export const CLASSIC_SWING_MODE_CODES: Record<SwingMode, string> = {
  off: "0",
  vertical: "1",
  horizontal: "2",
  both: "3",
};

// `f_dir_ud` and `f_dir_lr` carry a digit for stop and each fixed position, and
// a letter for the rest.
export const CLASSIC_LOUVER_STOP = "0";
export const CLASSIC_LOUVER_SWING = "S";
export const CLASSIC_VERTICAL_POSITION_CODES: Record<VerticalPosition, string> =
  {
    stop: CLASSIC_LOUVER_STOP,
    position1: "1",
    position2: "2",
    position3: "3",
    position4: "4",
    position5: "5",
    swing: CLASSIC_LOUVER_SWING,
    naturalWind: "N",
    auto: "A",
    floorWarming: "F",
    circulating: "C",
  };
export const CLASSIC_HORIZONTAL_POSITION_CODES: Record<
  HorizontalPosition,
  string
> = {
  stop: CLASSIC_LOUVER_STOP,
  position1: "1",
  position2: "2",
  position3: "3",
  position4: "4",
  position5: "5",
  swing: CLASSIC_LOUVER_SWING,
  auto: "A",
};

export const CLASSIC_HUMIDITY_SETTING_CODES: Record<HumiditySetting, string> = {
  off: "0",
  autoLow: "AUTO_L",
  auto: "AUTO",
  autoHigh: "AUTO_H",
  continuous: "CONTINUE",
};

/** What `stemp` and `shum` hold in a mode that has neither, such as fan. */
export const CLASSIC_NO_SETPOINT = "--";

/** `adv` holds one code for each special mode that is on, separated by
 * `/`. */
export const CLASSIC_SPECIAL_MODE_ADV_CODES: Record<SpecialMode, string> = {
  powerful: "2",
  econo: "12",
  streamer: "13",
};

/** `spmode_kind` in `set_special_mode`, which numbers the modes differently
 * from `adv`. The streamer has a parameter of its own, `en_streamer`. */
export const CLASSIC_SPECIAL_MODE_KIND_CODES: Record<
  Exclude<SpecialMode, "streamer">,
  string
> = {
  powerful: "1",
  econo: "2",
};

/** `en_spmode` sets one bit for each special mode the unit takes. Bit 8 is a
 * mode outside `SpecialMode`. */
export const CLASSIC_SPECIAL_MODE_BITS: Record<SpecialMode, number> = {
  powerful: 1,
  econo: 2,
  streamer: 4,
};

/** `type` in a discovery reply from an air conditioner's classic adapter. */
export const CLASSIC_ADAPTER_TYPE = "aircon";

/** `type` in `get_model_info` on a unit that only cools. */
export const CLASSIC_COOLING_ONLY_TYPE = "C";

/** `type` in `get_model_info` on a heat pump. */
export const CLASSIC_HEAT_PUMP_TYPE = "N";

/** The `cpv` values an adapter reports. */
export const CLASSIC_CAPABILITY_VERSIONS: readonly string[] = [
  "0",
  "1",
  "2",
  "3",
];

/** The fan levels a unit takes for each `frate_steps`. */
export const CLASSIC_FAN_LEVELS_BY_STEPS: Record<string, readonly FanSpeed[]> =
  {
    "2": ["level1", "level5"],
    "3": ["level1", "level3", "level5"],
    "5": ["level1", "level2", "level3", "level4", "level5"],
  };

/** `s_humd` is a decimal mask with one bit for each mode that takes a
 * humidity setting. */
export const CLASSIC_HUMIDITY_MODE_BITS = {
  auto: 0x01,
  cool: 0x02,
  heat: 0x04,
  dehumidify: 0x10,
} as const;

/** `s_fdir`: the axes the louvers swing on. */
export const CLASSIC_SWING_AXES_CODES = {
  none: "0",
  vertical: "1",
  both: "3",
} as const;

/** `mode` in `set_demand_control`. */
export const CLASSIC_DEMAND_MODE_CODES: Record<DemandMode, string> = {
  manual: "0",
  auto: "2",
};

/** The query parameter that carries the local password. */
export const CLASSIC_LOCAL_PASSWORD_PARAMETER = "lpw";

/** The `reg` of an adapter that reports none. */
export const CLASSIC_DEFAULT_REGION = "th";

/** `f_dir` while the vertical louver is at `floorWarming`. */
export const CLASSIC_FLOOR_WARMING_DIRECTION = "6";

/** `type` in `unregister_terminal`. */
export const CLASSIC_TERMINAL_SCOPE_CODES: Record<TerminalScope, string> = {
  self: "0",
  others: "1",
  all: "2",
};

/** `method`: the adapter is reached from outside the home network while it
 * polls, and from inside only otherwise. */
export const CLASSIC_REMOTE_METHODS = {
  polling: "polling",
  homeOnly: "home only",
} as const;
