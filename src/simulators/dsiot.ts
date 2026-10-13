import {
  DSIOT_ADAPTER_PATHS,
  DSIOT_ADAPTER_TYPE,
  DSIOT_COOLING_ONLY_MODEL_TYPE,
  DSIOT_EDGE_ROOT,
  DSIOT_EDGES,
  DSIOT_FAN_SPEED_CODES,
  DSIOT_FIXED_LOUVER_VALUES,
  DSIOT_HUMIDITY_OFF,
  DSIOT_HUMIDITY_SETTING_FLAGS,
  DSIOT_LOUVER_VALUES,
  DSIOT_MODE_PATHS,
  DSIOT_OFF,
  DSIOT_ON,
  DSIOT_OPERATING_MODE_CODES,
  DSIOT_OPERATIONS,
  DSIOT_PATHS,
  DSIOT_SPECIAL_MODE_PATHS,
} from "../codecs/dsiot/tables.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type {
  DaikinSensors,
  DaikinState,
  OperatingMode,
  SpecialMode,
} from "../models/state.js";
import {
  type DaikinSimulator,
  type DaikinSimulatorRequest,
  type DaikinSimulatorTemperatures,
  type DaikinSimulatorUnit,
  type SimulatorReply,
  type StartSimulatorOptions,
  startSimulator,
  unanswered,
} from "./simulator.js";

// A DSIOT adapter (BRP084) as an HTTP server. It reads the adapter's leaves
// and codes from the codecs' tables and shares none of their functions: see
// DESIGN.md#simulators.

const MULTIREQ_PATH = "/dsiot/multireq";
const REBOOT_PATH = "/config/system/reboot";

const RSC_OK = 2000;
const RSC_UPDATED = 2004;
const RSC_UNAUTHORIZED = 4001;

// A node's `pt`: 1 for one that holds children, and 2 or 3 for a leaf. A
// special mode's leaf is 2 on a unit that takes the mode.
const NODE_TYPE = 1;
const WRITTEN_LEAF_TYPE = 2;
const REPORTED_LEAF_TYPE = 3;

// The `pt` inside a leaf's `md`. What it stands for is not known: see
// UNSUPPORTED.md.
const METADATA_TYPE = "b";

const INDOOR = `${DSIOT_EDGE_ROOT}/${DSIOT_EDGES.indoor}`;
const OUTDOOR = `${DSIOT_EDGE_ROOT}/${DSIOT_EDGES.outdoor}`;

// A leaf's address is the `to` of its resource, then its path. Of the
// `dgc_status` entities, `e_1003` is on the outdoor edge and the rest on the
// indoor one.
function statusAddress(path: string): string {
  return `${path.includes(".e_1003.") ? OUTDOOR : INDOOR}.${path}`;
}

function adapterAddress(path: string): string {
  return `${DSIOT_EDGE_ROOT}.${path}`;
}

// A `to` names one resource: an edge, then one property of it.
const RESOURCE_PATTERN = /^(\/dsiot\/edge(?:\/\w+)?)\.(\w+)$/;
// The leaves of a `dgc_status` tree hold hex bytes.
const STATUS_ADDRESS_PATTERN = /\.dgc_status\./;

// Sent with every change of power, as 00 turning on, 01 turning off and 02
// unchanged. The adapter takes it and reports no such leaf.
const POWER_TRANSITION_ADDRESS = statusAddress(DSIOT_PATHS.powerTransition);

const POWER_ADDRESS = statusAddress(DSIOT_PATHS.power);
const MODE_ADDRESS = statusAddress(DSIOT_PATHS.mode);
const MODEL_TYPE_ADDRESS = statusAddress(DSIOT_PATHS.modelType);
// A signed byte of whole degrees, a byte of percent, and two bytes of half
// degrees.
const INDOOR_TEMPERATURE_ADDRESS = statusAddress(DSIOT_PATHS.indoorTemperature);
const INDOOR_HUMIDITY_ADDRESS = statusAddress(DSIOT_PATHS.indoorHumidity);
const OUTDOOR_TEMPERATURE_ADDRESS = statusAddress(
  DSIOT_PATHS.outdoorTemperature,
);
const SPECIAL_MODE_ADDRESSES: Record<SpecialMode, string> = {
  powerful: statusAddress(DSIOT_SPECIAL_MODE_PATHS.powerful),
  econo: statusAddress(DSIOT_SPECIAL_MODE_PATHS.econo),
  streamer: statusAddress(DSIOT_SPECIAL_MODE_PATHS.streamer),
};
const ADAPTER_NAME_ADDRESS = adapterAddress(DSIOT_ADAPTER_PATHS.name);
const ADAPTER_MAC_ADDRESS = adapterAddress(DSIOT_ADAPTER_PATHS.macAddress);
const ADAPTER_VERSION_ADDRESS = adapterAddress(
  DSIOT_ADAPTER_PATHS.firmwareVersion,
);

// A louver leaf is three bytes, the low byte first.
const LOUVER_BYTES = 3;

// What `DSIOT_PATHS.modelType` holds on a heat pump.
const HEAT_PUMP_MODEL_TYPE = "00";

// Every setting has a leaf for each mode, and the unit runs on those of the
// mode it is in. A signed setpoint is one byte of half degrees, and the rest
// two. Fan has neither a setpoint nor a humidity setting.
interface ModeLeaves {
  setpoint?: { address: string; bytes: number };
  humidityFlag?: string;
  fanSpeed: string;
  vertical: string;
  horizontal: string;
}
const modeLeaves = (mode: OperatingMode): ModeLeaves => {
  const { setpoint, humidity, fanSpeed, vertical, horizontal } =
    DSIOT_MODE_PATHS[mode];
  return {
    fanSpeed: statusAddress(fanSpeed),
    vertical: statusAddress(vertical),
    horizontal: statusAddress(horizontal),
    ...(setpoint === undefined
      ? {}
      : {
          setpoint: {
            address: statusAddress(setpoint.path),
            bytes: setpoint.signed ? 1 : 2,
          },
        }),
    ...(humidity === undefined
      ? {}
      : { humidityFlag: statusAddress(humidity.flag) }),
  };
};
const MODE_LEAVES: Record<OperatingMode, ModeLeaves> = {
  auto: modeLeaves("auto"),
  dehumidify: modeLeaves("dehumidify"),
  cool: modeLeaves("cool"),
  heat: modeLeaves("heat"),
  fan: modeLeaves("fan"),
};

// The leaves a discovery reply carries, under the names a classic
// `basic_info` gives them.
const DISCOVERY_FIELD_ADDRESSES = {
  reg: adapterAddress(DSIOT_ADAPTER_PATHS.region),
  ver: ADAPTER_VERSION_ADDRESS,
  mac: ADAPTER_MAC_ADDRESS,
  adp_kind: adapterAddress(DSIOT_ADAPTER_PATHS.kind),
  name: ADAPTER_NAME_ADDRESS,
} as const;

// A read's `filter` lists what each leaf comes with. `pn` and `pt` come
// whatever it lists.
const FILTER_VALUE = "pv";
const FILTER_METADATA = "md";

/** One leaf of an adapter's property trees. */
export interface DsiotSimulatorLeaf {
  /** The leaf's value. In a `dgc_status` tree it is hex bytes in upper case,
   * the low byte first where there are several. */
  pv: string;
  /** 2 or 3. A special mode's leaf is 2 on a unit that takes the mode. What
   * else tells the two apart is not known: the simulator takes a write to
   * either, and its own leaves are 2 where a write is known for the leaf. */
  pt: number;
  /** A setpoint's lowest and highest value in `mi` and `mx`, a louver's values
   * as a bit mask in `mx`, and a humidity value's step in `st`. */
  md?: { pt: string; st?: string; mi?: string; mx?: string };
}

export interface StartDsiotSimulatorOptions extends StartSimulatorOptions {
  /** What the unit has. Defaults to a heat pump with every fan speed, five
   * fixed vertical louver positions, swing on both axes and all three special
   * modes. A leaf in `leaves` replaces what this sets. */
  unit?: DaikinSimulatorUnit;
  /** Leaves added to the adapter's, each replacing a default at the same
   * address: see `DsiotDaikinSimulator.leaves`. Defaults to none. */
  leaves?: Record<string, DsiotSimulatorLeaf>;
  /** The child lock code. With one, the adapter answers `rsc` 4001 to a
   * request whose `Authorization` is not `Basic` and this code. Defaults to
   * none: no request needs an `Authorization`. */
  localPassword?: string;
}

/** A DSIOT adapter and the unit behind it. */
export interface DsiotDaikinSimulator extends DaikinSimulator {
  /** Every leaf the adapter reports, by its address: the `to` of its
   * resource, then the names down to the leaf, such as
   * `/dsiot/edge/adr_0100.dgc_status.e_1002.e_A002.p_01` for the power. A
   * write through the adapter changes a `pv`, and so do `setState` and
   * `setSensors`. For what those two do not cover, set a `pv` directly, and
   * delete a leaf or add one to change what the unit has. */
  readonly leaves: Record<string, DsiotSimulatorLeaf>;
}

interface PropertyNode {
  pn: string;
  pt: number;
  pv?: string;
  pch?: PropertyNode[];
  md?: DsiotSimulatorLeaf["md"];
}

/** Starts a DSIOT adapter on a free port, as a heat pump that is off, in
 * cool at 24 °C. It answers `/dsiot/multireq` reads and writes and
 * `/config/system/reboot`, over HTTP, and answers any other request with HTTP
 * 501: UNSUPPORTED.md lists what it leaves out and where its answer is not
 * known to be an adapter's. Call `stop` when done with it. */
export async function startDsiotSimulator(
  options: StartDsiotSimulatorOptions = {},
): Promise<DsiotDaikinSimulator> {
  const leaves = {
    ...applyUnit(defaultLeaves(), options.unit ?? {}),
    ...options.leaves,
  };

  const setState = (state: Partial<DaikinState>) => applyState(leaves, state);
  const setSensors = (sensors: Partial<DaikinSensors>) =>
    applySensors(leaves, sensors);
  // Before the server starts, so a state that throws leaves nothing
  // listening.
  applyDeviceInfo(leaves, options.deviceInfo ?? {});
  setState(options.state ?? {});
  setSensors(options.sensors ?? {});

  const read = (to: unknown): PropertyNode | undefined => {
    if (typeof to !== "string") {
      return undefined;
    }
    const [resource = "", query, ...rest] = to.split("?");
    const filter = query?.startsWith("filter=")
      ? query.slice("filter=".length).split(",")
      : undefined;
    const name = RESOURCE_PATTERN.exec(resource)?.[2];
    if (
      name === undefined ||
      rest.length > 0 ||
      (query !== undefined && filter === undefined)
    ) {
      return undefined;
    }
    const root: PropertyNode = { pn: name, pt: NODE_TYPE, pch: [] };
    for (const [address, leaf] of Object.entries(leaves)) {
      if (!address.startsWith(`${resource}.`)) {
        continue;
      }
      const names = address.slice(resource.length + 1).split(".");
      let node = root;
      for (const child of names.slice(0, -1)) {
        node = childNamed(node, child);
      }
      node.pch?.push({
        pn: names.at(-1) ?? "",
        pt: leaf.pt,
        ...(filter?.includes(FILTER_VALUE) === false ? {} : { pv: leaf.pv }),
        ...(leaf.md === undefined || filter?.includes(FILTER_METADATA) === false
          ? {}
          : { md: leaf.md }),
      });
    }
    return root.pch?.length === 0 ? undefined : root;
  };

  // The addresses and values a write names, or `undefined` for a write the
  // adapter is not known to take: one that names a leaf it does not report,
  // or a tree that is not the resource in `to`.
  const write = (
    to: unknown,
    content: unknown,
  ): [address: string, value: string][] | undefined => {
    const resource = typeof to === "string" ? to : "";
    const edge = RESOURCE_PATTERN.exec(resource)?.[1];
    const changes: [string, string][] = [];
    if (edge === undefined || !collectValues(content, edge, changes)) {
      return undefined;
    }
    return changes.every(
      ([address]) =>
        address.startsWith(`${resource}.`) &&
        (address in leaves || address === POWER_TRANSITION_ADDRESS),
    )
      ? changes
      : undefined;
  };

  const answer = (request: DaikinSimulatorRequest): SimulatorReply => {
    const reboots = request.path === REBOOT_PATH && request.method === "POST";
    const operation =
      request.path !== MULTIREQ_PATH
        ? undefined
        : request.method === "POST"
          ? DSIOT_OPERATIONS.get
          : request.method === "PUT"
            ? DSIOT_OPERATIONS.update
            : undefined;
    if (!reboots && operation === undefined) {
      return unanswered(request);
    }
    if (
      options.localPassword !== undefined &&
      request.headers.authorization !== `Basic ${options.localPassword}`
    ) {
      return json({ responses: [{ rsc: RSC_UNAUTHORIZED }] });
    }
    if (reboots) {
      return json({ rsc: RSC_OK });
    }

    const requests = parseRequests(request.body);
    if (requests === undefined || requests.some(({ op }) => op !== operation)) {
      return unanswered(request);
    }
    if (operation === DSIOT_OPERATIONS.get) {
      const trees = requests.map(({ to }) => read(to));
      return trees.includes(undefined)
        ? unanswered(request)
        : json({ responses: trees.map((pc) => ({ rsc: RSC_OK, pc })) });
    }
    const changes = requests.map(({ to, pc }) => write(to, pc));
    if (changes.includes(undefined)) {
      return unanswered(request);
    }
    for (const [address, value] of changes.flatMap((each) => each ?? [])) {
      const leaf = leaves[address];
      if (leaf !== undefined) {
        leaf.pv = heldValue(address, leaf.pv, value);
      }
    }
    return json({ responses: requests.map(() => ({ rsc: RSC_UPDATED })) });
  };

  // The discovery reply names these leaves as a classic `basic_info` does,
  // and carries the name percent-encoded.
  const discoveryFields = () => {
    const fields: Record<string, string> = { type: DSIOT_ADAPTER_TYPE };
    for (const [field, address] of Object.entries(DISCOVERY_FIELD_ADDRESSES)) {
      const value = leaves[address]?.pv;
      if (value !== undefined) {
        fields[field] = field === "name" ? encodeURIComponent(value) : value;
      }
    }
    fields.lpw_flag = options.localPassword === undefined ? "0" : "1";
    return fields;
  };

  const server = await startSimulator(options, answer, discoveryFields);

  return { ...server, leaves, setState, setSensors };
}

type Leaves = Record<string, DsiotSimulatorLeaf>;

function hold(leaves: Leaves, address: string, pv: string): void {
  const leaf = leaves[address];
  if (leaf === undefined) {
    throw new Error(`The simulated unit reports no leaf ${address} to set`);
  }
  leaf.pv = pv;
}

// `bytes` bytes of hex in upper case, the low byte first. A negative value is
// held as its two's complement.
function littleEndian(value: number, bytes: number): string {
  return Array.from({ length: bytes }, (_, index) =>
    ((value >> (8 * index)) & 0xff).toString(16).toUpperCase().padStart(2, "0"),
  ).join("");
}

function halfDegrees(temperatureInC: number, bytes: number): string {
  return littleEndian(Math.round(temperatureInC * 2), bytes);
}

// Removes the leaves a unit without something does not report, and sets the
// ones that say what it has. A field `unit` leaves out is left as it is.
function applyUnit(leaves: Leaves, unit: DaikinSimulatorUnit): Leaves {
  const modes = Object.values(MODE_LEAVES);
  if (unit.coolingOnly !== undefined) {
    hold(
      leaves,
      MODEL_TYPE_ADDRESS,
      unit.coolingOnly ? DSIOT_COOLING_ONLY_MODEL_TYPE : HEAT_PUMP_MODEL_TYPE,
    );
  }
  if (unit.fan === false) {
    for (const { fanSpeed } of modes) {
      delete leaves[fanSpeed];
    }
  }
  for (const { vertical, horizontal } of modes) {
    if (unit.swing === "none") {
      delete leaves[vertical];
    }
    if (unit.swing === "none" || unit.swing === "vertical") {
      delete leaves[horizontal];
    }
  }
  if (unit.specialModes !== undefined) {
    for (const [mode, address] of Object.entries(SPECIAL_MODE_ADDRESSES)) {
      if (!unit.specialModes.includes(mode as SpecialMode)) {
        delete leaves[address];
      }
    }
  }
  const limit = (
    mode: OperatingMode,
    temperatures: DaikinSimulatorTemperatures | undefined,
  ) => {
    const setpoint = MODE_LEAVES[mode].setpoint;
    const leaf = leaves[setpoint?.address ?? ""];
    if (temperatures !== undefined && setpoint && leaf) {
      leaf.md = {
        pt: METADATA_TYPE,
        mi: halfDegrees(temperatures.min, setpoint.bytes),
        mx: halfDegrees(temperatures.max, setpoint.bytes),
      };
    }
  };
  limit("cool", unit.coolTemperaturesInC);
  limit("heat", unit.heatTemperaturesInC);
  return leaves;
}

// The name as plain text, the MAC address without its colons, and the
// version with underscores for its dots.
function applyDeviceInfo(leaves: Leaves, info: DaikinDeviceInfo): void {
  if (info.name !== undefined) {
    hold(leaves, ADAPTER_NAME_ADDRESS, info.name);
  }
  if (info.macAddress !== undefined) {
    hold(leaves, ADAPTER_MAC_ADDRESS, info.macAddress.replaceAll(":", ""));
  }
  if (info.firmwareVersion !== undefined) {
    hold(
      leaves,
      ADAPTER_VERSION_ADDRESS,
      info.firmwareVersion.replaceAll(".", "_"),
    );
  }
}

function applySensors(leaves: Leaves, sensors: Partial<DaikinSensors>): void {
  const read = (address: string, pv: string | null | undefined) => {
    if (pv === null) {
      delete leaves[address];
    } else if (pv !== undefined) {
      leaves[address] = { pv, pt: REPORTED_LEAF_TYPE };
    }
  };
  const whole = (value: number | null | undefined) =>
    value == null ? value : littleEndian(Math.round(value), 1);
  read(INDOOR_TEMPERATURE_ADDRESS, whole(sensors.indoorTemperatureInC));
  read(INDOOR_HUMIDITY_ADDRESS, whole(sensors.indoorHumidityInPercent));
  read(
    OUTDOOR_TEMPERATURE_ADDRESS,
    sensors.outdoorTemperatureInC == null
      ? sensors.outdoorTemperatureInC
      : halfDegrees(sensors.outdoorTemperatureInC, 2),
  );
}

// Changes the leaves as the unit's remote control would: see
// `DaikinSimulator.setState`. Every setting but power and the special modes
// goes to the leaf of the mode the unit is then in.
function applyState(leaves: Leaves, state: Partial<DaikinState>): void {
  if (state.power != null) {
    hold(leaves, POWER_ADDRESS, state.power ? DSIOT_ON : DSIOT_OFF);
  }
  if (state.mode != null) {
    hold(leaves, MODE_ADDRESS, DSIOT_OPERATING_MODE_CODES[state.mode]);
  }
  if (state.specialModes != null) {
    for (const [mode, address] of Object.entries(SPECIAL_MODE_ADDRESSES)) {
      const on = state.specialModes.includes(mode as SpecialMode);
      if (on || address in leaves) {
        hold(leaves, address, on ? DSIOT_ON : DSIOT_OFF);
      }
    }
  }

  const held = leaves[MODE_ADDRESS]?.pv;
  const mode = (
    Object.keys(DSIOT_OPERATING_MODE_CODES) as OperatingMode[]
  ).find((each) => DSIOT_OPERATING_MODE_CODES[each] === held);
  const {
    targetTemperatureInC,
    targetHumidity,
    fanSpeed,
    swingMode,
    verticalPosition,
    horizontalPosition,
  } = state;
  if (mode === undefined) {
    if (
      [
        targetTemperatureInC,
        targetHumidity,
        fanSpeed,
        swingMode,
        verticalPosition,
        horizontalPosition,
      ].some((each) => each != null)
    ) {
      throw new Error(
        `The simulated unit is in a mode, ${held}, whose leaves are not known`,
      );
    }
    return;
  }
  const { setpoint, humidityFlag, ...addresses } = MODE_LEAVES[mode];
  const louver = (value: number) => littleEndian(value, LOUVER_BYTES);

  if (targetTemperatureInC != null) {
    if (setpoint === undefined) {
      throw new Error(`The simulated unit has no setpoint in ${mode}`);
    }
    hold(
      leaves,
      setpoint.address,
      halfDegrees(targetTemperatureInC, setpoint.bytes),
    );
  }
  if (targetHumidity != null) {
    if (humidityFlag === undefined || typeof targetHumidity !== "string") {
      throw new Error(
        humidityFlag === undefined
          ? `The simulated unit has no humidity setting in ${mode}`
          : "Set a humidity percentage in the simulator's leaves",
      );
    }
    hold(
      leaves,
      humidityFlag,
      targetHumidity === "off"
        ? DSIOT_HUMIDITY_OFF
        : DSIOT_HUMIDITY_SETTING_FLAGS[targetHumidity],
    );
  }
  if (fanSpeed != null) {
    hold(leaves, addresses.fanSpeed, DSIOT_FAN_SPEED_CODES[fanSpeed]);
  }
  if (swingMode != null) {
    const swings = {
      vertical: swingMode === "vertical" || swingMode === "both",
      horizontal: swingMode === "horizontal" || swingMode === "both",
    };
    for (const axis of ["vertical", "horizontal"] as const) {
      const address = addresses[axis];
      // An axis that stops swinging stops, and one at a fixed position keeps
      // it. A unit without the axis has nothing to stop.
      if (swings[axis]) {
        hold(leaves, address, louver(DSIOT_LOUVER_VALUES.swing));
      } else if (leaves[address]?.pv === louver(DSIOT_LOUVER_VALUES.swing)) {
        hold(leaves, address, louver(DSIOT_LOUVER_VALUES.stop));
      }
    }
  }
  for (const [axis, position] of [
    ["vertical", verticalPosition],
    ["horizontal", horizontalPosition],
  ] as const) {
    if (position == null) {
      continue;
    }
    const address = addresses[axis];
    const rank = FIXED_POSITIONS.indexOf(position);
    // A fixed position is the value at its rank among the fixed values the
    // unit takes. Which value a horizontal one is, is not known.
    const value =
      rank === -1
        ? DSIOT_LOUVER_VALUES[position as keyof typeof DSIOT_LOUVER_VALUES]
        : axis === "vertical"
          ? fixedLouverValues(leaves[address])[rank]
          : undefined;
    if (value === undefined) {
      throw new Error(`The simulated unit takes no ${axis} louver ${position}`);
    }
    hold(leaves, address, louver(value));
  }
}

const FIXED_POSITIONS: readonly string[] = [
  "position1",
  "position2",
  "position3",
  "position4",
  "position5",
];

function fixedLouverValues(leaf: DsiotSimulatorLeaf | undefined): number[] {
  const bytes = leaf?.md?.mx?.match(/../g) ?? [];
  const mask = Number.parseInt(bytes.reverse().join(""), 16);
  return DSIOT_FIXED_LOUVER_VALUES.filter((value) => mask & (1 << value));
}

function json(body: unknown): SimulatorReply {
  return { statusCode: 200, body: JSON.stringify(body) };
}

function parseRequests(
  body: string,
): { op?: unknown; to?: unknown; pc?: unknown }[] | undefined {
  try {
    const requests = (JSON.parse(body) as { requests?: unknown } | null)
      ?.requests;
    return Array.isArray(requests) &&
      requests.length > 0 &&
      requests.every((each) => typeof each === "object" && each !== null)
      ? requests
      : undefined;
  } catch {
    return undefined;
  }
}

function childNamed(parent: PropertyNode, name: string): PropertyNode {
  let child = parent.pch?.find((node) => node.pn === name);
  if (child === undefined) {
    child = { pn: name, pt: NODE_TYPE, pch: [] };
    parent.pch?.push(child);
  }
  return child;
}

// Adds each leaf under `node` to `changes`, by its address. It returns false
// for a node that has neither children nor a string value.
function collectValues(
  node: unknown,
  parent: string,
  changes: [string, string][],
): boolean {
  const { pn, pv, pch } = (node ?? {}) as Partial<
    Record<"pn" | "pv" | "pch", unknown>
  >;
  if (typeof pn !== "string") {
    return false;
  }
  const address = `${parent}.${pn}`;
  if (Array.isArray(pch)) {
    return (
      pch.length > 0 &&
      pch.every((child) => collectValues(child, address, changes))
    );
  }
  if (typeof pv !== "string") {
    return false;
  }
  changes.push([address, pv]);
  return true;
}

// A write may carry a `dgc_status` value in lower case, and as its low bytes
// alone: a setpoint of two bytes is written as one, `30` for `3000`.
function heldValue(address: string, held: string, written: string): string {
  return STATUS_ADDRESS_PATTERN.test(address)
    ? written.toUpperCase().padEnd(held.length, "0")
    : written;
}

function defaultLeaves(): Leaves {
  const reported = (pv: string): DsiotSimulatorLeaf => ({
    pv,
    pt: REPORTED_LEAF_TYPE,
  });
  const written = (
    pv: string,
    md?: { mi?: string; mx?: string },
  ): DsiotSimulatorLeaf => ({
    pv,
    pt: WRITTEN_LEAF_TYPE,
    ...(md === undefined ? {} : { md: { pt: METADATA_TYPE, ...md } }),
  });
  const setpoint = (
    mode: OperatingMode,
    temperatureInC: number,
    minInC: number,
    maxInC: number,
  ) => {
    const { address = "", bytes = 0 } = MODE_LEAVES[mode].setpoint ?? {};
    return {
      [address]: written(halfDegrees(temperatureInC, bytes), {
        mi: halfDegrees(minInC, bytes),
        mx: halfDegrees(maxInC, bytes),
      }),
    };
  };
  // The values each louver takes: stop and swing, and five fixed positions
  // on the vertical one.
  const louverMask = (...values: number[]) =>
    littleEndian(
      values.reduce((mask, value) => mask | (1 << value), 0),
      4,
    );
  const { stop, swing } = DSIOT_LOUVER_VALUES;
  const stopped = littleEndian(stop, LOUVER_BYTES);

  const leaves: Leaves = {
    [adapterAddress(DSIOT_ADAPTER_PATHS.kind)]: reported("4"),
    [ADAPTER_VERSION_ADDRESS]: reported("2_8_0"),
    [adapterAddress(DSIOT_ADAPTER_PATHS.region)]: reported("th"),
    [ADAPTER_MAC_ADDRESS]: reported("02DA1C000002"),
    [adapterAddress(DSIOT_ADAPTER_PATHS.scheduleTimer)]: reported("1"),
    [adapterAddress(DSIOT_ADAPTER_PATHS.demandControl)]: reported("1"),
    [adapterAddress(DSIOT_ADAPTER_PATHS.energyMonitoring)]: reported("1"),
    [ADAPTER_NAME_ADDRESS]: written("Simulator"),

    [statusAddress(DSIOT_PATHS.model)]: reported("0ABB"),
    [MODEL_TYPE_ADDRESS]: reported(HEAT_PUMP_MODEL_TYPE),
    [POWER_ADDRESS]: written(DSIOT_OFF),
    [INDOOR_TEMPERATURE_ADDRESS]: reported("1A"),
    [INDOOR_HUMIDITY_ADDRESS]: reported("37"),
    [statusAddress(DSIOT_PATHS.energyMonitoring)]: reported(DSIOT_ON),
    [SPECIAL_MODE_ADDRESSES.econo]: written(DSIOT_OFF),
    [SPECIAL_MODE_ADDRESSES.streamer]: written(DSIOT_OFF),

    [MODE_ADDRESS]: written(DSIOT_OPERATING_MODE_CODES.cool),
    ...setpoint("cool", 24, 18, 32),
    ...setpoint("heat", 25, 10, 30),
    ...setpoint("auto", 25, 18, 30),

    [OUTDOOR_TEMPERATURE_ADDRESS]: reported("3C00"),
    [SPECIAL_MODE_ADDRESSES.powerful]: written(DSIOT_OFF),
  };
  for (const { fanSpeed, vertical, horizontal } of Object.values(MODE_LEAVES)) {
    leaves[fanSpeed] = written(DSIOT_FAN_SPEED_CODES.auto);
    leaves[vertical] = written(stopped, {
      mx: louverMask(stop, 1, 2, 3, 4, 5, swing),
    });
    leaves[horizontal] = written(stopped, { mx: louverMask(stop, swing) });
  }
  return leaves;
}
