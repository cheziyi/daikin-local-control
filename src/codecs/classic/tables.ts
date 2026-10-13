import type { TerminalScope } from "../../models/extendedControl.js";
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
