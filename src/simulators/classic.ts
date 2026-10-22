import {
  CLASSIC_ADAPTER_TYPE,
  CLASSIC_COOLING_ONLY_TYPE,
  CLASSIC_FAN_SPEED_CODES,
  CLASSIC_HEAT_PUMP_TYPE,
  CLASSIC_HORIZONTAL_POSITION_CODES,
  CLASSIC_HUMIDITY_SETTING_CODES,
  CLASSIC_LOCAL_PASSWORD_PARAMETER,
  CLASSIC_LOUVER_STOP,
  CLASSIC_LOUVER_SWING,
  CLASSIC_NO_SETPOINT,
  CLASSIC_OPERATING_MODE_CODES,
  CLASSIC_REMOTE_METHODS,
  CLASSIC_SPECIAL_MODE_ADV_CODES,
  CLASSIC_SPECIAL_MODE_BITS,
  CLASSIC_SPECIAL_MODE_KIND_CODES,
  CLASSIC_SWING_AXES_CODES,
  CLASSIC_SWING_MODE_CODES,
  CLASSIC_TERMINAL_SCOPE_CODES,
  CLASSIC_VERTICAL_POSITION_CODES,
} from "../codecs/classic/tables.js";
import { DAIKIN_TERMINAL_UUID_HEADER } from "../codecs/tables.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type { DaikinSensors, DaikinState } from "../models/state.js";
import {
  type DaikinSimulator,
  type DaikinSimulatorRequest,
  type DaikinSimulatorUnit,
  formatKeyValue,
  type SimulatorReply,
  type StartSimulatorOptions,
  startSimulator,
  unanswered,
} from "./simulator.js";

// A classic adapter (BRP069, BRP072) as an HTTP server. It reads the adapter's
// codes from the codecs' tables and shares none of their functions: see
// DESIGN.md#simulators.

const DEFAULT_BASIC_INFO: Record<string, string> = {
  type: CLASSIC_ADAPTER_TYPE,
  reg: "th",
  ver: "1_2_51",
  name: "Simulator",
  icon: "0",
  method: CLASSIC_REMOTE_METHODS.homeOnly,
  adp_kind: "4",
  cpv: "3",
  cpv_minor: "20",
  led: "1",
  mac: "02DA1C000001",
  en_hol: "0",
  grp_name: "",
  en_grp: "0",
};

const DEFAULT_MODEL_INFO: Record<string, string> = {
  model: "0ABB",
  type: "N",
  en_frate: "1",
  en_frate_auto: "1",
  en_frate_silent: "1",
  frate_steps: "5",
  en_fdir: "1",
  s_fdir: "3",
  s_humd: "0",
  en_spmode: "7",
  elec: "1",
  dmnd: "1",
  en_scdltmr: "1",
};

const DEFAULT_CONTROL_INFO: Record<string, string> = {
  pow: "0",
  mode: "3",
  adv: "",
  stemp: "24.0",
  shum: "0",
  dt1: "25.0",
  dt2: "M",
  dt3: "24.0",
  dt4: "25.0",
  dh1: "0",
  dh2: "0",
  dh3: "0",
  dh4: "0",
  f_rate: "A",
  f_dir: "0",
  dfr1: "A",
  dfr2: "A",
  dfr3: "A",
  dfr4: "A",
  dfr6: "A",
  dfd1: "0",
  dfd2: "0",
  dfd3: "0",
  dfd4: "0",
  dfd6: "0",
};

const DEFAULT_SENSOR_INFO: Record<string, string> = {
  htemp: "26.0",
  hhum: "55",
  otemp: "30.0",
};

const DEFAULT_REMOTE_METHOD: Record<string, string> = {
  notice_ip_int: "3600",
  notice_sync_int: "60",
};

const REGISTER_TERMINAL_PATH = "/common/register_terminal";

// A `set_control_info` without one of these is answered `PARAM NG`. `shum`
// joins them on a unit whose `get_control_info` reports it.
const REQUIRED_CONTROL_PARAMETERS = ["pow", "mode", "stemp", "f_rate"];
// The parameters `set_control_info` stores: the control fields, and the
// memory of a mode by name, such as `dt3`, `dfd4` and `ndfd4`.
const CONTROL_PARAMETER_PATTERN =
  /^(pow|mode|stemp|shum|f_rate|f_dir|f_dir_ud|f_dir_lr|(dt|dh|dfd|ndfd)\w)$/;
// The control field each memory prefix remembers: `dt3` holds the `stemp` of
// mode 3.
const MODE_MEMORY_FIELDS = {
  dt: "stemp",
  dh: "shum",
  dfr: "f_rate",
  dfd: "f_dir",
} as const;

// `spmode_kind` 4 is heat plus, which `adv` reports as 4. It is outside
// `SpecialMode`: see UNSUPPORTED.md.
const HEAT_PLUS_KIND_CODE = "4";
const HEAT_PLUS_ADV_CODE = "4";
// Powerful, econo and heat plus replace one another in `adv`.
const ADV_CODES_BY_SPECIAL_MODE_KIND: Record<string, string> = {
  [CLASSIC_SPECIAL_MODE_KIND_CODES.powerful]:
    CLASSIC_SPECIAL_MODE_ADV_CODES.powerful,
  [CLASSIC_SPECIAL_MODE_KIND_CODES.econo]: CLASSIC_SPECIAL_MODE_ADV_CODES.econo,
  [HEAT_PLUS_KIND_CODE]: HEAT_PLUS_ADV_CODE,
};

// A sensor field the unit has no reading for.
const NO_READING = "-";

/** What a simulated classic unit has. */
export interface ClassicSimulatorUnit extends DaikinSimulatorUnit {
  /** How many fan levels the unit takes: `level1` and `level5` for 2,
   * `level3` as well for 3, and all five for 5. Defaults to 5. */
  fanLevels?: 2 | 3 | 5;
}

export interface StartClassicSimulatorOptions extends StartSimulatorOptions {
  /** What the unit has. Defaults to a heat pump with every fan speed, swing
   * on both axes and all three special modes. A field of `modelInfo`
   * replaces what this sets. */
  unit?: ClassicSimulatorUnit;
  /** Fields added to the `/common/basic_info` reply, each replacing a default
   * of the same name. Defaults to none. */
  basicInfo?: Record<string, string>;
  /** Fields added to the `/aircon/get_model_info` reply, each replacing a
   * default of the same name. Defaults to none. */
  modelInfo?: Record<string, string>;
  /** Fields added to the `/aircon/get_control_info` reply, each replacing a
   * default of the same name. Defaults to none. */
  controlInfo?: Record<string, string>;
  /** Fields added to the `/aircon/get_sensor_info` reply, each replacing a
   * default of the same name. Defaults to none. */
  sensorInfo?: Record<string, string>;
  /** The KEY on the adapter's label. With one, the adapter requires
   * registration: it reports `en_secure=1`, and answers a terminal uuid with
   * HTTP 403 until `/common/register_terminal` is sent this key. Defaults to
   * none: every terminal is answered. */
  key?: string;
  /** The child lock code. With one, the adapter reports `lpw_flag=1`, and
   * answers `ret=LPW NG` to a request whose `lpw` is not this code. Defaults
   * to none: no request needs an `lpw`. */
  localPassword?: string;
}

/** A classic adapter and the unit behind it. Each field map is what its
 * endpoint answers, in the adapter's own names and encodings, without the
 * `ret`. A write through the adapter changes them, and so do `setState` and
 * `setSensors`. Change a field directly for what those two do not cover. */
export interface ClassicDaikinSimulator extends DaikinSimulator {
  /** What `/common/basic_info` answers. `name` and `grp_name` are held
   * percent-encoded, as the reply carries them. */
  readonly basicInfo: Record<string, string>;
  /** What `/aircon/get_model_info` answers. */
  readonly modelInfo: Record<string, string>;
  /** What `/aircon/get_control_info` answers. */
  readonly controlInfo: Record<string, string>;
  /** What `/aircon/get_sensor_info` answers. */
  readonly sensorInfo: Record<string, string>;
  /** What `/common/get_remote_method` answers. */
  readonly remoteMethod: Record<string, string>;
  /** The terminal uuids `/common/register_terminal` has registered. Only an
   * adapter started with a `key` checks them. */
  readonly registeredTerminalUuids: Set<string>;
}

/** Starts a classic adapter on a free port, as a heat pump that is off, in
 * cool at 24 °C. It answers the endpoints `ClassicDaikinClient` has a typed
 * method for, over HTTP, and answers any other request with HTTP 501:
 * UNSUPPORTED.md lists what it leaves out and where its answer is not known
 * to be an adapter's. Call `stop` when done with it. */
export async function startClassicSimulator(
  options: StartClassicSimulatorOptions = {},
): Promise<ClassicDaikinSimulator> {
  const basicInfo: Record<string, string> = {
    ...DEFAULT_BASIC_INFO,
    lpw_flag: flag(options.localPassword !== undefined),
    ...(options.key === undefined ? {} : { en_secure: "1" }),
    ...options.basicInfo,
  };
  const modelInfo = {
    ...DEFAULT_MODEL_INFO,
    ...encodeUnit(options.unit ?? {}),
    ...options.modelInfo,
  };
  const controlInfo = { ...DEFAULT_CONTROL_INFO, ...options.controlInfo };
  const sensorInfo = { ...DEFAULT_SENSOR_INFO, ...options.sensorInfo };
  const remoteMethod = { ...DEFAULT_REMOTE_METHOD };
  const registeredTerminalUuids = new Set<string>();

  const setState = (state: Partial<DaikinState>) =>
    applyState(controlInfo, state);
  const setSensors = (sensors: Partial<DaikinSensors>) =>
    Object.assign(sensorInfo, encodeSensors(sensors));
  // Before the server starts, so a state that throws leaves nothing
  // listening.
  Object.assign(basicInfo, encodeDeviceInfo(options.deviceInfo ?? {}));
  setState(options.state ?? {});
  setSensors(options.sensors ?? {});

  const reads: Record<string, () => Record<string, string>> = {
    "/common/basic_info": () => basicInfo,
    // The reply carries the `method` of `basic_info` as well.
    "/common/get_remote_method": () => ({
      method: basicInfo.method ?? "",
      ...remoteMethod,
    }),
    "/aircon/get_model_info": () => modelInfo,
    "/aircon/get_control_info": () => controlInfo,
    "/aircon/get_sensor_info": () => sensorInfo,
  };

  // Each write returns false for a request that lacks a parameter.
  const writes: Record<
    string,
    (query: Record<string, string>, terminalUuid: string | undefined) => boolean
  > = {
    "/aircon/set_control_info": (query) => {
      const required =
        "shum" in controlInfo
          ? [...REQUIRED_CONTROL_PARAMETERS, "shum"]
          : REQUIRED_CONTROL_PARAMETERS;
      if (!hasEvery(query, required)) {
        return false;
      }
      for (const [name, value] of Object.entries(query)) {
        if (CONTROL_PARAMETER_PATTERN.test(name) && name in controlInfo) {
          controlInfo[name] = value;
        }
      }
      rememberMode(controlInfo);
      return true;
    },
    "/aircon/set_special_mode": (query) => {
      const codes = new Set(controlInfo.adv?.split("/").filter(Boolean));
      const kindCode = ADV_CODES_BY_SPECIAL_MODE_KIND[query.spmode_kind ?? ""];
      if (query.en_streamer !== undefined) {
        codes.delete(CLASSIC_SPECIAL_MODE_ADV_CODES.streamer);
        if (query.en_streamer === "1") {
          codes.add(CLASSIC_SPECIAL_MODE_ADV_CODES.streamer);
        }
      } else if (query.set_spmode !== undefined && kindCode !== undefined) {
        for (const code of Object.values(ADV_CODES_BY_SPECIAL_MODE_KIND)) {
          codes.delete(code);
        }
        if (query.set_spmode === "1") {
          codes.add(kindCode);
        }
      } else {
        return false;
      }
      controlInfo.adv = [...codes]
        .sort((first, second) => Number(first) - Number(second))
        .join("/");
      return true;
    },
    "/aircon/set_demand_control": (query) =>
      hasEvery(query, ["demand_type", "en_demand", "mode", "max_pow"]),
    "/aircon/set_price": (query) => hasEvery(query, ["price_int", "price_dec"]),
    "/aircon/set_target": (query) => hasEvery(query, ["target"]),
    "/common/set_led": (query) => copy(query, basicInfo, ["led"]),
    "/common/set_holiday": (query) => copy(query, basicInfo, ["en_hol"]),
    "/common/set_icon": (query) => copy(query, basicInfo, ["icon"]),
    "/common/set_name": (query) => {
      if (query.name === undefined) {
        return false;
      }
      basicInfo.name = encodeURIComponent(query.name);
      return true;
    },
    "/common/set_group": (query) => {
      if (query.grp_name === undefined || query.en_grp === undefined) {
        return false;
      }
      basicInfo.grp_name = encodeURIComponent(query.grp_name);
      basicInfo.en_grp = query.en_grp;
      return true;
    },
    "/common/set_remote_method": (query) => {
      if (!copy(query, basicInfo, ["method"])) {
        return false;
      }
      for (const name of Object.keys(remoteMethod)) {
        const value = query[name];
        if (value !== undefined) {
          remoteMethod[name] = value;
        }
      }
      return true;
    },
    "/common/reboot": () => true,
    "/common/unregister_terminal": (query, terminalUuid) => {
      const others = [...registeredTerminalUuids].filter(
        (uuid) => uuid !== terminalUuid,
      );
      if (
        query.type === CLASSIC_TERMINAL_SCOPE_CODES.self &&
        terminalUuid !== undefined
      ) {
        registeredTerminalUuids.delete(terminalUuid);
      } else if (query.type === CLASSIC_TERMINAL_SCOPE_CODES.others) {
        for (const uuid of others) {
          registeredTerminalUuids.delete(uuid);
        }
      } else if (query.type === CLASSIC_TERMINAL_SCOPE_CODES.all) {
        registeredTerminalUuids.clear();
      } else {
        return false;
      }
      return true;
    },
  };

  const answer = (request: DaikinSimulatorRequest): SimulatorReply => {
    const read = reads[request.path];
    const write = writes[request.path];
    const registers = request.path === REGISTER_TERMINAL_PATH;
    if (
      request.method !== "GET" ||
      (read === undefined && write === undefined && !registers)
    ) {
      return unanswered(request);
    }

    const terminalUuid = terminalUuidOf(request);
    if (registers) {
      if (options.key === undefined) {
        return unanswered(request);
      }
      if (request.query.key !== options.key || terminalUuid === undefined) {
        return FORBIDDEN;
      }
      registeredTerminalUuids.add(terminalUuid);
      return reply("OK");
    }
    if (
      options.key !== undefined &&
      (terminalUuid === undefined || !registeredTerminalUuids.has(terminalUuid))
    ) {
      return FORBIDDEN;
    }
    if (
      options.localPassword !== undefined &&
      request.query[CLASSIC_LOCAL_PASSWORD_PARAMETER] !== options.localPassword
    ) {
      return reply("LPW NG");
    }

    if (read !== undefined) {
      return reply("OK", read());
    }
    return reply(write?.(request.query, terminalUuid) ? "OK" : "PARAM NG");
  };

  // The discovery reply carries the fields of `basic_info`.
  const server = await startSimulator(options, answer, () => basicInfo);

  return {
    ...server,
    basicInfo,
    modelInfo,
    controlInfo,
    sensorInfo,
    remoteMethod,
    registeredTerminalUuids,
    setState,
    setSensors,
  };
}

// The `get_model_info` fields that say what `unit` has. A field `unit` leaves
// out is left to the defaults.
function encodeUnit(unit: ClassicSimulatorUnit): Record<string, string> {
  const fields: Record<string, string> = {};
  if (unit.coolingOnly !== undefined) {
    fields.type = unit.coolingOnly
      ? CLASSIC_COOLING_ONLY_TYPE
      : CLASSIC_HEAT_PUMP_TYPE;
  }
  if (unit.fan !== undefined) {
    fields.en_frate = flag(unit.fan);
  }
  if (unit.fanLevels !== undefined) {
    fields.frate_steps = String(unit.fanLevels);
  }
  if (unit.swing !== undefined) {
    fields.en_fdir = flag(unit.swing !== "none");
    fields.s_fdir = CLASSIC_SWING_AXES_CODES[unit.swing];
  }
  if (unit.specialModes !== undefined) {
    fields.en_spmode = String(
      unit.specialModes.reduce(
        (bits, mode) => bits | CLASSIC_SPECIAL_MODE_BITS[mode],
        0,
      ),
    );
  }
  if (unit.coolTemperaturesInC !== undefined) {
    fields.cmlmt_l = unit.coolTemperaturesInC.min.toFixed(1);
    fields.cmlmt_h = unit.coolTemperaturesInC.max.toFixed(1);
  }
  if (unit.heatTemperaturesInC !== undefined) {
    fields.hmlmt_l = unit.heatTemperaturesInC.min.toFixed(1);
    fields.hmlmt_h = unit.heatTemperaturesInC.max.toFixed(1);
  }
  return fields;
}

// The `basic_info` fields: the name percent-encoded, the MAC address without
// its colons, and the version with underscores for its dots.
function encodeDeviceInfo(info: DaikinDeviceInfo): Record<string, string> {
  return {
    ...(info.name === undefined ? {} : { name: encodeURIComponent(info.name) }),
    ...(info.macAddress === undefined
      ? {}
      : { mac: info.macAddress.replaceAll(":", "") }),
    ...(info.firmwareVersion === undefined
      ? {}
      : { ver: info.firmwareVersion.replaceAll(".", "_") }),
  };
}

function encodeSensors(
  sensors: Partial<DaikinSensors>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const {
    indoorTemperatureInC,
    outdoorTemperatureInC,
    indoorHumidityInPercent,
  } = sensors;
  if (indoorTemperatureInC !== undefined) {
    fields.htemp = indoorTemperatureInC?.toFixed(1) ?? NO_READING;
  }
  if (outdoorTemperatureInC !== undefined) {
    fields.otemp = outdoorTemperatureInC?.toFixed(1) ?? NO_READING;
  }
  if (indoorHumidityInPercent !== undefined) {
    fields.hhum = indoorHumidityInPercent?.toFixed(0) ?? NO_READING;
  }
  return fields;
}

// Changes `controlInfo` as the unit's remote control would: see
// `DaikinSimulator.setState`.
function applyState(
  controlInfo: Record<string, string>,
  state: Partial<DaikinState>,
): void {
  const hold = (field: string, value: string) => {
    if (!(field in controlInfo)) {
      throw new Error(`The simulated unit reports no ${field} to set`);
    }
    controlInfo[field] = value;
  };
  const hasLouvers = "f_dir_ud" in controlInfo && "f_dir_lr" in controlInfo;

  if (state.power != null) {
    hold("pow", flag(state.power));
  }
  if (
    state.mode != null &&
    CLASSIC_OPERATING_MODE_CODES[state.mode] !== controlInfo.mode
  ) {
    controlInfo.mode = CLASSIC_OPERATING_MODE_CODES[state.mode];
    recallMode(controlInfo);
  }
  if (state.targetTemperatureInC != null) {
    hold("stemp", state.targetTemperatureInC.toFixed(1));
  }
  if (state.targetHumidity != null) {
    hold(
      "shum",
      typeof state.targetHumidity === "string"
        ? CLASSIC_HUMIDITY_SETTING_CODES[state.targetHumidity]
        : String(state.targetHumidity.percent),
    );
  }
  if (state.fanSpeed != null) {
    hold("f_rate", CLASSIC_FAN_SPEED_CODES[state.fanSpeed]);
  }
  if (state.swingMode != null) {
    const swings = {
      f_dir_ud: state.swingMode === "vertical" || state.swingMode === "both",
      f_dir_lr: state.swingMode === "horizontal" || state.swingMode === "both",
    };
    if (hasLouvers) {
      // An axis that stops swinging stops, and one at a fixed position
      // keeps it.
      for (const [field, swing] of Object.entries(swings)) {
        if (swing) {
          controlInfo[field] = CLASSIC_LOUVER_SWING;
        } else if (controlInfo[field] === CLASSIC_LOUVER_SWING) {
          controlInfo[field] = CLASSIC_LOUVER_STOP;
        }
      }
    } else {
      hold("f_dir", CLASSIC_SWING_MODE_CODES[state.swingMode]);
    }
  }
  if (state.verticalPosition != null) {
    hold("f_dir_ud", CLASSIC_VERTICAL_POSITION_CODES[state.verticalPosition]);
  }
  if (state.horizontalPosition != null) {
    hold(
      "f_dir_lr",
      CLASSIC_HORIZONTAL_POSITION_CODES[state.horizontalPosition],
    );
  }
  // `f_dir` sets bit 1 while the vertical louver swings and bit 2 while the
  // horizontal one does.
  if (hasLouvers && "f_dir" in controlInfo) {
    controlInfo.f_dir = String(
      (controlInfo.f_dir_ud === CLASSIC_LOUVER_SWING ? 1 : 0) |
        (controlInfo.f_dir_lr === CLASSIC_LOUVER_SWING ? 2 : 0),
    );
  }
  if (state.specialModes != null) {
    hold(
      "adv",
      state.specialModes
        .map((mode) => Number(CLASSIC_SPECIAL_MODE_ADV_CODES[mode]))
        .sort((first, second) => first - second)
        .join("/"),
    );
  }
  rememberMode(controlInfo);
}

// Takes up what the unit remembers for the mode it is now in. A mode without
// a `dt` or a `dh` has no setpoint or humidity setting.
function recallMode(controlInfo: Record<string, string>): void {
  const mode = controlInfo.mode ?? "";
  for (const [prefix, field] of Object.entries(MODE_MEMORY_FIELDS)) {
    if (field in controlInfo) {
      controlInfo[field] =
        controlInfo[`${prefix}${mode}`] ??
        (prefix === "dt" || prefix === "dh"
          ? CLASSIC_NO_SETPOINT
          : (controlInfo[field] ?? ""));
    }
  }
  const [vertical, horizontal] = controlInfo[`ndfd${mode}`] ?? "";
  if ("f_dir_ud" in controlInfo && vertical !== undefined) {
    controlInfo.f_dir_ud = vertical;
  }
  if ("f_dir_lr" in controlInfo && horizontal !== undefined) {
    controlInfo.f_dir_lr = horizontal;
  }
}

const FORBIDDEN: SimulatorReply = { statusCode: 403, body: "" };

// A classic adapter answers HTTP 200 whatever the `ret`.
function reply(ret: string, fields?: Record<string, string>): SimulatorReply {
  return { statusCode: 200, body: formatKeyValue(ret, fields) };
}

function terminalUuidOf(request: DaikinSimulatorRequest): string | undefined {
  // Node lowercases the names of the headers it receives.
  const header = request.headers[DAIKIN_TERMINAL_UUID_HEADER.toLowerCase()];
  return typeof header === "string" ? header : undefined;
}

function flag(on: boolean): string {
  return on ? "1" : "0";
}

function hasEvery(query: Record<string, string>, names: string[]): boolean {
  return names.every((name) => name in query);
}

function copy(
  query: Record<string, string>,
  fields: Record<string, string>,
  names: string[],
): boolean {
  if (!hasEvery(query, names)) {
    return false;
  }
  for (const name of names) {
    fields[name] = query[name] ?? "";
  }
  return true;
}

// An adapter remembers the setpoint, humidity, fan speed and direction of
// each mode, and answers them as `dt3`, `dh3`, `dfr3` and `dfd3` for mode 3.
// It takes `dt`, `dh` and `dfd` as parameters and no `dfr`, so it keeps the
// memory of the mode the unit is in equal to what the unit holds. `ndfd3`
// holds the `f_dir_ud` value of mode 3, then its `f_dir_lr` value.
function rememberMode(controlInfo: Record<string, string>): void {
  const mode = controlInfo.mode ?? "";
  for (const [prefix, field] of Object.entries(MODE_MEMORY_FIELDS)) {
    const value = controlInfo[field];
    if (`${prefix}${mode}` in controlInfo && value !== undefined) {
      controlInfo[`${prefix}${mode}`] = value;
    }
  }
  const { f_dir_ud: vertical, f_dir_lr: horizontal } = controlInfo;
  if (
    `ndfd${mode}` in controlInfo &&
    vertical !== undefined &&
    horizontal !== undefined
  ) {
    controlInfo[`ndfd${mode}`] = `${vertical}${horizontal}`;
  }
}
