import {
  AIRBASE_FAN_SPEED_CODES,
  AIRBASE_NO_SETPOINT,
  AIRBASE_OPERATING_MODE_CODES,
  AIRBASE_VERTICAL_POSITION_CODES,
  AIRBASE_ZONE_LIST_SEPARATOR,
  AIRBASE_ZONE_TEMPERATURE_FIELDS,
  type AirbaseVerticalPosition,
} from "../codecs/airbase/tables.js";
import { CLASSIC_ADAPTER_TYPE } from "../codecs/classic/tables.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type { DaikinSensors, DaikinState } from "../models/state.js";
import {
  type DaikinSimulator,
  type DaikinSimulatorRequest,
  type DaikinSimulatorTemperatures,
  formatKeyValue,
  type SimulatorReply,
  type StartSimulatorOptions,
  startSimulator,
  unanswered,
} from "./simulator.js";

// An Airbase adapter (BRP15B61) as an HTTP server. It reads the adapter's
// codes from the codec's tables and shares none of its functions: see
// DESIGN.md#simulators.

// Every endpoint is below this path, and any other path is answered HTTP 404.
const ROOT = "/skyfi";

// An Airbase adapter replies to the discovery probe as a classic adapter of
// an air conditioner does.
const DEFAULT_BASIC_INFO: Record<string, string> = {
  type: CLASSIC_ADAPTER_TYPE,
  reg: "au",
  ver: "1_1_8",
  name: "Simulator",
  mac: "02DA1C000002",
  lpw_flag: "0",
};

const DEFAULT_MODEL_INFO: Record<string, string> = {
  model: "NOTSUPPORT",
  en_auto: "1",
  en_dry: "1",
  en_frate: "1",
  en_frate_auto: "1",
  frate_steps: "3",
  en_fdir: "1",
};

const { cool: COOL, heat: HEAT } = AIRBASE_OPERATING_MODE_CODES;

const DEFAULT_CONTROL_INFO: Record<string, string> = {
  pow: "0",
  mode: COOL,
  bk_auto: COOL,
  stemp: "24.0",
  f_rate: AIRBASE_FAN_SPEED_CODES.auto,
  f_auto: "0",
  f_airside: "0",
  f_dir: AIRBASE_VERTICAL_POSITION_CODES.position1,
  dt1: "25.0",
  dt2: "24.0",
  dfr1: AIRBASE_FAN_SPEED_CODES.auto,
  dfr2: AIRBASE_FAN_SPEED_CODES.auto,
  dfd1: AIRBASE_VERTICAL_POSITION_CODES.position1,
  dfd2: AIRBASE_VERTICAL_POSITION_CODES.position1,
  auto1: "0",
  auto2: "0",
  airside1: "0",
  airside2: "0",
};

const DEFAULT_SENSOR_INFO: Record<string, string> = {
  htemp: "26.0",
  otemp: "30.0",
};

// A `set_control_info` without one of these is answered `PARAM NG`.
const REQUIRED_CONTROL_PARAMETERS = [
  "pow",
  "mode",
  "stemp",
  "shum",
  "f_rate",
  "f_auto",
  "f_airside",
  "f_dir",
];
// The parameters `set_control_info` stores: the control fields, and what the
// unit remembers for cool and for heat, such as `dt2` and `auto1`.
const CONTROL_PARAMETER_PATTERN =
  /^(pow|mode|bk_auto|stemp|shum|f_rate|f_auto|f_airside|f_dir|(dt|dfr|dfd|auto|airside)\w)$/;
// The control field each memory prefix remembers: `dfr2` holds the `f_rate`
// of cool.
const MEMORY_FIELDS = {
  dt: "stemp",
  dfr: "f_rate",
  dfd: "f_dir",
  auto: "f_auto",
  airside: "f_airside",
} as const;

// The lists of `get_zone_setting` are held percent-encoded.
const ZONE_PARAMETERS = ["zone_name", "zone_onoff"];
// A unit that sets a temperature for each zone holds these as well.
const ZONE_TEMPERATURE_PARAMETERS = Object.values(
  AIRBASE_ZONE_TEMPERATURE_FIELDS,
);

// A sensor field the unit has no reading for.
const NO_READING = "-";

/** What a simulated Airbase unit has. Anything else about it is set in the
 * adapter's own terms, in `modelInfo`. */
export interface AirbaseSimulatorUnit {
  /** The names of the unit's zones, each open at the start. Defaults to none:
   * a unit without zones. A unit with zones takes fan auto, and neither the
   * `auto` fan speed nor a direction. */
  zones?: readonly string[];
  /** Whether the unit offers auto. Defaults to true. */
  auto?: boolean;
  /** Whether the unit offers dehumidify. Defaults to true. */
  dehumidify?: boolean;
  /** Whether the fan speed can be set. Defaults to true. */
  fan?: boolean;
  /** How many fan levels the unit takes: `level1` and `level5` for 2, and
   * `level3` as well for 3. Defaults to 3. */
  fanLevels?: 2 | 3;
  /** Whether a unit with zones takes airside. Defaults to false. */
  airside?: boolean;
  /** Whether a unit without zones takes a direction. Defaults to true. */
  swing?: boolean;
  /** The setpoints cool takes, in whole degrees. Defaults to none
   * reported. */
  coolTemperaturesInC?: DaikinSimulatorTemperatures;
  /** The setpoints heat takes, in whole degrees. Defaults to none
   * reported. */
  heatTemperaturesInC?: DaikinSimulatorTemperatures;
}

export interface StartAirbaseSimulatorOptions extends StartSimulatorOptions {
  /** What the unit has. Defaults to a unit without zones that offers every
   * mode, three fan levels and the `auto` fan speed, and takes a direction.
   * A field of `modelInfo` replaces what this sets. */
  unit?: AirbaseSimulatorUnit;
  /** Fields added to the `/skyfi/common/basic_info` reply, each replacing a
   * default of the same name. Defaults to none. */
  basicInfo?: Record<string, string>;
  /** Fields added to the `/skyfi/aircon/get_model_info` reply, each replacing
   * a default of the same name. Defaults to none. */
  modelInfo?: Record<string, string>;
  /** Fields added to the `/skyfi/aircon/get_control_info` reply, each
   * replacing a default of the same name. Defaults to none. */
  controlInfo?: Record<string, string>;
  /** Fields added to the `/skyfi/aircon/get_sensor_info` reply, each replacing
   * a default of the same name. Defaults to none. */
  sensorInfo?: Record<string, string>;
  /** Fields added to the `/skyfi/aircon/get_zone_setting` reply, each
   * replacing what `unit.zones` sets. Defaults to none. */
  zoneSetting?: Record<string, string>;
}

/** An Airbase adapter and the unit behind it. Each field map is what its
 * endpoint answers, in the adapter's own names and encodings, without the
 * `ret`. A write through the adapter changes them, and so do `setState`,
 * `setSensors` and `setZone`. `setState` sets the louver through
 * `verticalPosition`, and throws for a `swingMode`. Change a field directly
 * for what those do not cover, such as `controlInfo.f_auto` for fan auto. */
export interface AirbaseDaikinSimulator extends DaikinSimulator {
  /** What `/skyfi/common/basic_info` answers. `name` is held percent-encoded,
   * as the reply carries it. */
  readonly basicInfo: Record<string, string>;
  /** What `/skyfi/aircon/get_model_info` answers. */
  readonly modelInfo: Record<string, string>;
  /** What `/skyfi/aircon/get_control_info` answers. */
  readonly controlInfo: Record<string, string>;
  /** What `/skyfi/aircon/get_sensor_info` answers. */
  readonly sensorInfo: Record<string, string>;
  /** What `/skyfi/aircon/get_zone_setting` answers, each list held
   * percent-encoded, as the reply carries it. Empty on a unit without
   * zones. */
  readonly zoneSetting: Record<string, string>;
  /** Opens or closes the zone at `index`, counted from 0, as the unit's wall
   * controller would. It throws an `Error` for an index the unit has no zone
   * at. */
  setZone(index: number, enabled: boolean): void;
}

/** Starts an Airbase adapter on a free port, as a unit without zones that is
 * off, in cool at 24 °C. It answers the endpoints `AirbaseDaikinClient` has a
 * typed method for, below `/skyfi`, and takes no terminal uuid and no local
 * password. It answers HTTP 404 to a path outside `/skyfi`, as an Airbase
 * adapter does, and HTTP 501 to any other request it has no answer for:
 * UNSUPPORTED.md lists what it leaves out and where its answer is not known
 * to be an adapter's. Call `stop` when done with it. */
export async function startAirbaseSimulator(
  options: StartAirbaseSimulatorOptions = {},
): Promise<AirbaseDaikinSimulator> {
  const unit = options.unit ?? {};
  const basicInfo = { ...DEFAULT_BASIC_INFO, ...options.basicInfo };
  const modelInfo = {
    ...DEFAULT_MODEL_INFO,
    ...encodeUnit(unit),
    ...options.modelInfo,
  };
  const controlInfo = { ...DEFAULT_CONTROL_INFO, ...options.controlInfo };
  const sensorInfo = { ...DEFAULT_SENSOR_INFO, ...options.sensorInfo };
  const zoneSetting = {
    ...encodeZones(unit.zones ?? []),
    ...options.zoneSetting,
  };

  const setState = (state: Partial<DaikinState>) =>
    applyState(controlInfo, state);
  const setSensors = (sensors: Partial<DaikinSensors>) =>
    Object.assign(sensorInfo, encodeSensors(sensors));
  const setZone = (index: number, enabled: boolean) => {
    const flags = decodeList(zoneSetting.zone_onoff);
    if (!Number.isInteger(index) || index < 0 || index >= flags.length) {
      throw new Error(`The simulated unit has no zone ${index}`);
    }
    flags[index] = flag(enabled);
    zoneSetting.zone_onoff = encodeList(flags);
  };
  // Before the server starts, so a state that throws leaves nothing
  // listening.
  Object.assign(basicInfo, encodeDeviceInfo(options.deviceInfo ?? {}));
  setState(options.state ?? {});
  setSensors(options.sensors ?? {});

  const hasZones = () => "zone_name" in zoneSetting;
  const reads: Record<string, () => Record<string, string> | undefined> = {
    "/common/basic_info": () => basicInfo,
    "/aircon/get_model_info": () => modelInfo,
    "/aircon/get_control_info": () => controlInfo,
    "/aircon/get_sensor_info": () => sensorInfo,
    // What a unit without zones answers is not known.
    "/aircon/get_zone_setting": () => (hasZones() ? zoneSetting : undefined),
  };

  // Each write returns false for a request that lacks a parameter, and
  // `undefined` for one the simulator has no answer for.
  const writes: Record<
    string,
    (query: Record<string, string>) => boolean | undefined
  > = {
    "/aircon/set_control_info": (query) => {
      if (!hasEvery(query, REQUIRED_CONTROL_PARAMETERS)) {
        return false;
      }
      for (const [name, value] of Object.entries(query)) {
        if (CONTROL_PARAMETER_PATTERN.test(name) && name in controlInfo) {
          controlInfo[name] = value;
        }
      }
      remember(controlInfo);
      return true;
    },
    "/aircon/set_zone_setting": (query) => {
      if (!hasZones()) {
        return undefined;
      }
      if (!hasEvery(query, ZONE_PARAMETERS)) {
        return false;
      }
      for (const name of [...ZONE_PARAMETERS, ...ZONE_TEMPERATURE_PARAMETERS]) {
        const value = query[name];
        if (value !== undefined && name in zoneSetting) {
          zoneSetting[name] = encodeURIComponent(value);
        }
      }
      return true;
    },
  };

  const answer = (request: DaikinSimulatorRequest): SimulatorReply => {
    if (!request.path.startsWith(`${ROOT}/`)) {
      return NOT_FOUND;
    }
    if (request.method !== "GET") {
      return unanswered(request);
    }
    const path = request.path.slice(ROOT.length);
    const fields = reads[path]?.();
    if (fields !== undefined) {
      return reply("OK", fields);
    }
    const written = writes[path]?.(request.query);
    return written === undefined
      ? unanswered(request)
      : reply(written ? "OK" : "PARAM NG");
  };

  // The discovery reply carries the fields of `basic_info`.
  const server = await startSimulator(options, answer, () => basicInfo);

  return {
    ...server,
    basicInfo,
    modelInfo,
    controlInfo,
    sensorInfo,
    zoneSetting,
    setState,
    setSensors,
    setZone,
  };
}

// The `get_model_info` fields that say what `unit` has. A field `unit` leaves
// out is left to the defaults.
function encodeUnit(unit: AirbaseSimulatorUnit): Record<string, string> {
  const fields: Record<string, string> = {};
  if (unit.zones !== undefined && unit.zones.length > 0) {
    fields.en_zone = String(unit.zones.length);
  }
  if (unit.auto !== undefined) {
    fields.en_auto = flag(unit.auto);
  }
  if (unit.dehumidify !== undefined) {
    fields.en_dry = flag(unit.dehumidify);
  }
  if (unit.fan !== undefined) {
    fields.en_frate = flag(unit.fan);
  }
  if (unit.fanLevels !== undefined) {
    fields.frate_steps = String(unit.fanLevels);
  }
  if (unit.airside !== undefined) {
    fields.en_airside = flag(unit.airside);
  }
  if (unit.swing !== undefined) {
    fields.en_fdir = flag(unit.swing);
  }
  if (unit.coolTemperaturesInC !== undefined) {
    fields.cool_l = unit.coolTemperaturesInC.min.toFixed(0);
    fields.cool_h = unit.coolTemperaturesInC.max.toFixed(0);
  }
  if (unit.heatTemperaturesInC !== undefined) {
    fields.heat_l = unit.heatTemperaturesInC.min.toFixed(0);
    fields.heat_h = unit.heatTemperaturesInC.max.toFixed(0);
  }
  return fields;
}

// The `get_zone_setting` fields of a unit with these zones, each open. A unit
// without zones has none.
function encodeZones(names: readonly string[]): Record<string, string> {
  return names.length === 0
    ? {}
    : {
        zone_name: encodeList(names),
        zone_onoff: encodeList(names.map(() => flag(true))),
      };
}

function encodeList(values: readonly string[]): string {
  return encodeURIComponent(values.join(AIRBASE_ZONE_LIST_SEPARATOR));
}

function decodeList(value: string | undefined): string[] {
  return value === undefined
    ? []
    : decodeURIComponent(value).split(AIRBASE_ZONE_LIST_SEPARATOR);
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

// Changes `controlInfo` as the unit's wall controller would: see
// `DaikinSimulator.setState`.
function applyState(
  controlInfo: Record<string, string>,
  state: Partial<DaikinState>,
): void {
  for (const field of [
    "targetHumidity",
    "swingMode",
    "horizontalPosition",
  ] as const) {
    if (state[field] != null) {
      throw new Error(`The simulated unit has no ${field} to set`);
    }
  }
  if (state.specialModes != null && state.specialModes.length > 0) {
    throw new Error("The simulated unit has no specialModes to set");
  }
  if (
    state.verticalPosition != null &&
    !(state.verticalPosition in AIRBASE_VERTICAL_POSITION_CODES)
  ) {
    throw new Error(
      `The simulated unit takes no verticalPosition ${state.verticalPosition}`,
    );
  }

  if (state.power != null) {
    controlInfo.pow = flag(state.power);
  }
  if (
    state.mode != null &&
    AIRBASE_OPERATING_MODE_CODES[state.mode] !== controlInfo.mode
  ) {
    controlInfo.mode = AIRBASE_OPERATING_MODE_CODES[state.mode];
    recall(controlInfo);
  }
  if (state.targetTemperatureInC != null) {
    controlInfo.stemp = state.targetTemperatureInC.toFixed(1);
  }
  if (state.fanSpeed != null) {
    controlInfo.f_rate = AIRBASE_FAN_SPEED_CODES[state.fanSpeed];
  }
  if (state.verticalPosition != null) {
    controlInfo.f_dir =
      AIRBASE_VERTICAL_POSITION_CODES[
        state.verticalPosition as AirbaseVerticalPosition
      ];
  }
  remember(controlInfo);
}

// The unit remembers a setpoint, a fan and a direction for cool and for heat
// alone, and every other mode runs on the one `bk_auto` names. A unit set to
// cool or to heat names that mode there.
function memoryOf(controlInfo: Record<string, string>): string {
  if (controlInfo.mode === COOL || controlInfo.mode === HEAT) {
    controlInfo.bk_auto = controlInfo.mode;
  }
  return controlInfo.bk_auto === HEAT ? HEAT : COOL;
}

// Takes up what the unit remembers for the mode it is now in. Dehumidify has
// no setpoint.
function recall(controlInfo: Record<string, string>): void {
  const memory = memoryOf(controlInfo);
  for (const [prefix, field] of Object.entries(MEMORY_FIELDS)) {
    const remembered = controlInfo[`${prefix}${memory}`];
    if (remembered !== undefined) {
      controlInfo[field] = remembered;
    }
  }
  if (controlInfo.mode === AIRBASE_OPERATING_MODE_CODES.dehumidify) {
    controlInfo.stemp = AIRBASE_NO_SETPOINT;
  }
}

// Keeps what the unit remembers for the mode it runs on equal to what it
// holds. A setpoint is remembered in cool and in heat alone.
function remember(controlInfo: Record<string, string>): void {
  const memory = memoryOf(controlInfo);
  for (const [prefix, field] of Object.entries(MEMORY_FIELDS)) {
    const value = controlInfo[field];
    const isSetpoint = prefix === "dt";
    if (
      `${prefix}${memory}` in controlInfo &&
      value !== undefined &&
      (!isSetpoint || controlInfo.mode === memory)
    ) {
      controlInfo[`${prefix}${memory}`] = value;
    }
  }
}

const NOT_FOUND: SimulatorReply = { statusCode: 404, body: "" };

// An Airbase adapter answers HTTP 200 whatever the `ret`.
function reply(ret: string, fields?: Record<string, string>): SimulatorReply {
  return { statusCode: 200, body: formatKeyValue(ret, fields) };
}

function flag(on: boolean): string {
  return on ? "1" : "0";
}

function hasEvery(query: Record<string, string>, names: string[]): boolean {
  return names.every((name) => name in query);
}
