import type {
  FanSpeed,
  HorizontalPosition,
  HumiditySetting,
  OperatingMode,
  SpecialMode,
  VerticalPosition,
} from "../../models/state.js";

// The resources, leaves and codes a DSIOT adapter holds each value of a model
// as. The codecs and the simulators both read them from here: see
// DESIGN.md#simulators.

export const DSIOT_OPERATIONS = {
  get: 2,
  update: 3,
  delete: 4,
} as const;

/** The indoor and the outdoor unit are separate edges on the adapter. */
export const DSIOT_EDGES = {
  indoor: "adr_0100",
  outdoor: "adr_0200",
} as const;

/** What the `to` of a request starts with: an adapter resource follows as
 * `.adp_i`, and a unit's as `/adr_0100.dgc_status`. */
export const DSIOT_EDGE_ROOT = "/dsiot/edge";

/** What a read fetches, as the `to` of a request: whole trees, never single
 * leaves. The status trees come with `pt`, which `parseDsiotCapabilities`
 * reads. */
export const DSIOT_TARGETS = {
  adapterInfo: `${DSIOT_EDGE_ROOT}.adp_i?filter=pv`,
  adapterSettings: `${DSIOT_EDGE_ROOT}.adp_d?filter=pv`,
  indoorStatus: `${DSIOT_EDGE_ROOT}/${DSIOT_EDGES.indoor}.dgc_status?filter=pv,pt,md`,
  outdoorStatus: `${DSIOT_EDGE_ROOT}/${DSIOT_EDGES.outdoor}.dgc_status?filter=pv,pt,md`,
} as const;

/** `type` in a discovery reply from a DSIOT adapter. */
export const DSIOT_ADAPTER_TYPE = "GPF";

/** `cdev` in a discovery reply from a DSIOT adapter whose unit is an air
 * conditioner. A reply without one is an air conditioner's as well; `1D` and
 * `CJ` are an air cleaner's. */
export const DSIOT_AIR_CONDITIONER_DEVICES: readonly string[] = ["RA", "NA"];

/** Dotted paths into the `adp_i` and `adp_d` trees. The MAC address and the
 * version hold the value a classic adapter sends in `basic_info`, and the
 * name is plain text, where a classic adapter form-encodes it. */
export const DSIOT_ADAPTER_PATHS = {
  name: "adp_d.name",
  macAddress: "adp_i.mac",
  firmwareVersion: "adp_i.ver",
  region: "adp_i.reg",
  kind: "adp_i.kind",
  energyMonitoring: "adp_i.func.en_ipower",
  demandControl: "adp_i.func.en_demand",
  scheduleTimer: "adp_i.func.en_scdltmr",
} as const;

/** Full dotted paths into the `dgc_status` trees. `e_1002` lives on the indoor
 * edge and `e_1003` on the outdoor edge. */
export const DSIOT_PATHS = {
  power: "dgc_status.e_1002.e_A002.p_01",
  /** Sent with every control. */
  powerTransition: "dgc_status.e_1002.e_3003.p_2D",
  mode: "dgc_status.e_1002.e_3001.p_01",
  indoorTemperature: "dgc_status.e_1002.e_A00B.p_01",
  indoorHumidity: "dgc_status.e_1002.e_A00B.p_02",
  outdoorTemperature: "dgc_status.e_1003.e_A00D.p_01",
  model: "dgc_status.e_1002.e_A001.p_0D",
  modelType: "dgc_status.e_1002.e_A001.p_07",
  energyMonitoring: "dgc_status.e_1002.e_A011.p_01",
  /** Holds 0 on a unit with the special air outlet. */
  specialOutlet: "dgc_status.e_1002.e_3003.p_43",
} as const;

/** What a leaf that is on or off holds, such as the power. */
export const DSIOT_ON = "01";
export const DSIOT_OFF = "00";

/** `DSIOT_PATHS.modelType` on a unit that only cools. */
export const DSIOT_COOLING_ONLY_MODEL_TYPE = "01";

/** `DSIOT_PATHS.modelType` on a heat pump. */
export const DSIOT_HEAT_PUMP_MODEL_TYPE = "00";

/** The header that carries the local password, as `DSIOT_LOCAL_PASSWORD_SCHEME`
 * and the code itself, not base64. */
export const DSIOT_LOCAL_PASSWORD_HEADER = "Authorization";
export const DSIOT_LOCAL_PASSWORD_SCHEME = "Basic";

/** Each leaf holds `01` while its mode is on, and has `pt` 2 on a unit that
 * takes the mode. Powerful is on the outdoor edge. */
export const DSIOT_SPECIAL_MODE_PATHS: Record<SpecialMode, string> = {
  powerful: "dgc_status.e_1003.e_3002.p_44",
  econo: "dgc_status.e_1002.e_3003.p_24",
  streamer: "dgc_status.e_1002.e_3003.p_20",
  heatPlus: "dgc_status.e_1002.e_3003.p_1C",
};

export interface DsiotSetpoint {
  path: string;
  /** Auto and dehumidify are a signed byte; cool and heat are little-endian. */
  signed: boolean;
  /** The dehumidify setpoint is read-only. */
  writable: boolean;
}

export interface DsiotHumidity {
  /** Counted in steps of the leaf's `md.st`. */
  value: string;
  /** The setting: `00` or `05` off, `01` the percentage in `value`, and one
   * value for each `HumiditySetting`. */
  flag: string;
}

export interface DsiotModePaths {
  /** Absent in fan mode. */
  setpoint?: DsiotSetpoint;
  /** Absent in fan mode. */
  humidity?: DsiotHumidity;
  fanSpeed: string;
  vertical: string;
  horizontal: string;
}

export const DSIOT_MODE_NODE = "dgc_status.e_1002.e_3001";

export const DSIOT_MODE_PATHS: Record<OperatingMode, DsiotModePaths> = {
  auto: {
    setpoint: { path: `${DSIOT_MODE_NODE}.p_1D`, signed: true, writable: true },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_2E`,
      flag: `${DSIOT_MODE_NODE}.p_2F`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_26`,
    vertical: `${DSIOT_MODE_NODE}.p_20`,
    horizontal: `${DSIOT_MODE_NODE}.p_21`,
  },
  dehumidify: {
    setpoint: {
      path: `${DSIOT_MODE_NODE}.p_1E`,
      signed: true,
      writable: false,
    },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_30`,
      flag: `${DSIOT_MODE_NODE}.p_31`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_27`,
    vertical: `${DSIOT_MODE_NODE}.p_22`,
    horizontal: `${DSIOT_MODE_NODE}.p_23`,
  },
  cool: {
    setpoint: {
      path: `${DSIOT_MODE_NODE}.p_02`,
      signed: false,
      writable: true,
    },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_0B`,
      flag: `${DSIOT_MODE_NODE}.p_0C`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_09`,
    vertical: `${DSIOT_MODE_NODE}.p_05`,
    horizontal: `${DSIOT_MODE_NODE}.p_06`,
  },
  heat: {
    setpoint: {
      path: `${DSIOT_MODE_NODE}.p_03`,
      signed: false,
      writable: true,
    },
    humidity: {
      value: `${DSIOT_MODE_NODE}.p_2C`,
      flag: `${DSIOT_MODE_NODE}.p_2D`,
    },
    fanSpeed: `${DSIOT_MODE_NODE}.p_0A`,
    vertical: `${DSIOT_MODE_NODE}.p_07`,
    horizontal: `${DSIOT_MODE_NODE}.p_08`,
  },
  fan: {
    fanSpeed: `${DSIOT_MODE_NODE}.p_28`,
    vertical: `${DSIOT_MODE_NODE}.p_24`,
    horizontal: `${DSIOT_MODE_NODE}.p_25`,
  },
};

export const DSIOT_OPERATING_MODE_CODES: Record<OperatingMode, string> = {
  fan: "0000",
  heat: "0100",
  cool: "0200",
  auto: "0300",
  dehumidify: "0500",
};

/** The other mode values an adapter reports, and the mode whose leaves each
 * one runs on. A write sends the value back as it came, which the adapter is
 * not known to take: see UNSUPPORTED.md. */
export const DSIOT_OPERATING_MODE_ALIASES: Record<string, OperatingMode> = {
  "0900": "cool",
  "0A00": "heat",
};

/** What `DSIOT_PATHS.powerTransition` is written as, beside the power. */
export const DSIOT_POWER_TRANSITION_CODES = {
  turningOn: "00",
  turningOff: "01",
  unchanged: "02",
} as const;

export const DSIOT_FAN_SPEED_CODES: Record<FanSpeed, string> = {
  auto: "0A00",
  silent: "0B00",
  level1: "0300",
  level2: "0400",
  level3: "0500",
  level4: "0600",
  level5: "0700",
};

/** The values a louver leaf holds besides a fixed position, which is 1-14.
 * The leaf is three bytes, little-endian, and bit n of its `md.mx` is set
 * when the unit takes value n. */
export const DSIOT_LOUVER_VALUES = {
  stop: 0,
  swing: 15,
  auto: 16,
  naturalWind: 19,
  circulating: 20,
  floorWarming: 25,
} as const;

/** The values that are fixed positions: 1 to 14. */
export const DSIOT_FIXED_LOUVER_VALUES = Array.from(
  { length: 14 },
  (_, index) => index + 1,
);

export const DSIOT_LOUVER_STOP = "000000";
export const DSIOT_LOUVER_SWING = "0F0000";

/** The value each `VerticalPosition` is held as. A fixed position has none: it
 * is held as the value at its rank among the fixed values the unit takes. */
export const DSIOT_VERTICAL_POSITION_VALUES: Partial<
  Record<VerticalPosition, number>
> = {
  stop: DSIOT_LOUVER_VALUES.stop,
  swing: DSIOT_LOUVER_VALUES.swing,
  naturalWind: DSIOT_LOUVER_VALUES.naturalWind,
  auto: DSIOT_LOUVER_VALUES.auto,
  floorWarming: DSIOT_LOUVER_VALUES.floorWarming,
  circulating: DSIOT_LOUVER_VALUES.circulating,
};

/** The value each `HorizontalPosition` is held as. `stop` and a fixed position
 * have none: see UNSUPPORTED.md. */
export const DSIOT_HORIZONTAL_POSITION_VALUES: Partial<
  Record<HorizontalPosition, number>
> = {
  swing: DSIOT_LOUVER_VALUES.swing,
  auto: DSIOT_LOUVER_VALUES.auto,
};

/** What a humidity flag holds while the setting is off. */
export const DSIOT_HUMIDITY_OFF = "00";
/** What a humidity flag holds while the setting is a percentage, held in the
 * mode's `value` leaf. */
export const DSIOT_HUMIDITY_PERCENTAGE = "01";
/** Also reads as off, and a control that switches humidity off leaves it. */
export const DSIOT_HUMIDITY_OFF_KEPT = "05";
export const DSIOT_HUMIDITY_SETTING_FLAGS: Record<
  Exclude<HumiditySetting, "off">,
  string
> = {
  auto: "02",
  autoHigh: "03",
  autoLow: "04",
  continuous: "06",
};
