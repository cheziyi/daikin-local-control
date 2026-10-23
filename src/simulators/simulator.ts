import { createSocket, type Socket } from "node:dgram";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DAIKIN_DISCOVERY_PORT,
  DAIKIN_DISCOVERY_PROBE,
} from "../codecs/tables.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type {
  DaikinSensors,
  DaikinState,
  SpecialMode,
} from "../models/state.js";

// What the simulators share: the HTTP server, and the reply to a discovery
// probe, which every adapter sends in the same form.

const DEFAULT_ADDRESS = "127.0.0.1";

/** One HTTP request a simulator received. */
export interface DaikinSimulatorRequest {
  method: string;
  /** From the leading `/`, without the query string. */
  path: string;
  /** Percent-decoded. */
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: string;
}

/** What every simulator resolves with. */
export interface DaikinSimulator {
  /** `<address>:<port>`, as `DaikinDevice.host` takes it: `127.0.0.1`, unless
   * the simulator was started at another `address`, and a port that was free
   * when it started. */
  readonly host: string;
  /** Every request received, oldest first, the ones the simulator refused
   * included. A request is added once its whole body has arrived, before it
   * waits for its turn to be answered. */
  readonly requests: DaikinSimulatorRequest[];
  /** Changes the unit as its remote control would. A field left out, or
   * `null`, stays as the unit holds it, and a new `mode` takes up what the
   * unit remembers for that mode before the other fields are applied. It
   * throws an `Error` for a field the unit has nothing to hold, such as a
   * `verticalPosition` on a unit without fixed louver positions, and holds
   * any other value as given, whether or not `getCapabilities` lists it. */
  setState(state: Partial<DaikinState>): void;
  /** Changes what the unit's sensors read. A reading left out stays as it is,
   * and `null` is a reading the unit does not report. */
  setSensors(sensors: Partial<DaikinSensors>): void;
  /** Closes every connection and stops listening. A request still waiting is
   * never answered. */
  stop(): Promise<void>;
}

/** In °C. */
export interface DaikinSimulatorTemperatures {
  min: number;
  max: number;
}

/** What a simulated unit has, where the classic and the DSIOT protocol can
 * both say it. Anything else about a unit is set in the adapter's own terms:
 * `modelInfo` on a classic simulator, and `leaves` on a DSIOT one. An Airbase
 * simulator takes an `AirbaseSimulatorUnit` instead. */
export interface DaikinSimulatorUnit {
  /** A unit that only cools offers dehumidify, cool and fan. Defaults to
   * false: a heat pump, which offers auto and heat as well. */
  coolingOnly?: boolean;
  /** Whether the fan speed can be set. Defaults to true. */
  fan?: boolean;
  /** The axes the louvers swing on: `vertical` moves the air up and down
   * alone, and `both` left and right as well. Defaults to `both`. */
  swing?: "none" | "vertical" | "both";
  /** The special modes the unit takes. Defaults to all four. */
  specialModes?: readonly SpecialMode[];
  /** The setpoints cool takes. A classic adapter reports whole degrees.
   * Defaults to 18 to 32 on a DSIOT simulator, and to none reported on a
   * classic one. */
  coolTemperaturesInC?: DaikinSimulatorTemperatures;
  /** The setpoints heat takes. A classic adapter reports whole degrees.
   * Defaults to 10 to 30 on a DSIOT simulator, and to none reported on a
   * classic one. */
  heatTemperaturesInC?: DaikinSimulatorTemperatures;
}

/** The options every simulator takes. A simulator applies `deviceInfo`,
 * `state` and `sensors` after the fields given in the adapter's own terms, so
 * they replace a field given both ways. */
export interface StartSimulatorOptions {
  /** The adapter's name, MAC address and firmware version, as
   * `getDeviceInfo` reads them back. A field left out keeps its default.
   * Defaults to a name of `Simulator`. */
  deviceInfo?: DaikinDeviceInfo;
  /** The state the unit starts in: see `DaikinSimulator.setState`. Defaults
   * to off, in cool at 24 °C on the auto fan speed, with nothing swinging
   * and no special mode on. */
  state?: Partial<DaikinState>;
  /** What the unit's sensors read at the start: see
   * `DaikinSimulator.setSensors`. Defaults to 26 °C and 55 % indoors, and
   * 30 °C outdoors. An Airbase simulator reports no humidity unless it is
   * given one. */
  sensors?: Partial<DaikinSensors>;
  /** How long, in milliseconds, the adapter takes to answer a request. It
   * answers one request at a time, in the order they arrive, so a request
   * waits this long for each one ahead of it as well. Defaults to 0. */
  replyDelayInMs?: number;
  /** The address of this machine the adapter is at: it listens for HTTP
   * there, and answers a discovery probe from there. Defaults to `127.0.0.1`,
   * which nothing outside the machine reaches. */
  address?: string;
  /** Whether the adapter answers the discovery probe, so `discoverDevices`
   * finds it at `host`. Defaults to false. Any number of simulators answer
   * at once, in one process or several, and `discoverDevices` finds each at
   * its own port. Starting one rejects with the socket's error only while a
   * program that is not a simulator holds UDP port 30050. */
  answersDiscovery?: boolean;
}

/** What `startSimulator` resolves with: the part of a `DaikinSimulator` that
 * is the same for every protocol. */
export type SimulatorServer = Pick<
  DaikinSimulator,
  "host" | "requests" | "stop"
>;

export interface SimulatorReply {
  statusCode: number;
  body: string;
}

/** The reply to a request whose answer from an adapter is not known: HTTP 501,
 * which no adapter is known to send, so a caller cannot take it for one. */
export function unanswered(request: DaikinSimulatorRequest): SimulatorReply {
  return {
    statusCode: 501,
    body: `The simulator does not answer ${request.method} ${request.path}`,
  };
}

/** Joins fields as a classic reply and a discovery reply carry them:
 * `key=value` pairs separated by commas, `ret` first. */
export function formatKeyValue(
  ret: string,
  fields: Record<string, string> = {},
): string {
  return Object.entries({ ret, ...fields })
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
}

/** Listens on a free port of `options.address` and answers each request with
 * what `answer` returns for it, one request at a time. With
 * `options.answersDiscovery`, it answers the discovery probe with
 * `discoveryFields()` and the HTTP port, as `api_port`. */
export async function startSimulator(
  options: StartSimulatorOptions,
  answer: (request: DaikinSimulatorRequest) => SimulatorReply,
  discoveryFields: () => Record<string, string>,
): Promise<SimulatorServer> {
  const requests: DaikinSimulatorRequest[] = [];
  let stopped = false;
  let turn = Promise.resolve();

  const server = createServer((incoming, response) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk: string) => {
      body += chunk;
    });
    incoming.on("end", () => {
      const url = new URL(incoming.url ?? "/", "http://simulator");
      const request: DaikinSimulatorRequest = {
        method: incoming.method ?? "",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: incoming.headers,
        body,
      };
      requests.push(request);
      turn = turn.then(async () => {
        if (options.replyDelayInMs) {
          await sleep(options.replyDelayInMs);
        }
        if (stopped) {
          return;
        }
        const reply = answer(request);
        response.statusCode = reply.statusCode;
        response.end(reply.body);
      });
    });
  });
  const address = options.address ?? DEFAULT_ADDRESS;
  server.listen(0, address);
  // `once` rejects when the server emits `error` first, as it does for an
  // address the machine does not have.
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const stopServer = async () => {
    // A client keeps its connection open between requests, and `close` alone
    // waits for it.
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  };

  let discoverySockets: Socket[] = [];
  if (options.answersDiscovery) {
    try {
      discoverySockets = await startDiscoverySockets(address, () =>
        formatKeyValue("OK", {
          ...discoveryFields(),
          api_port: String(port),
        }),
      );
    } catch (error) {
      await stopServer();
      throw error;
    }
  }

  return {
    host: `${address}:${port}`,
    requests,
    async stop() {
      // A server closed a second time never emits `close`.
      if (stopped) {
        return;
      }
      stopped = true;
      await Promise.all(discoverySockets.map(closeSocket));
      await stopServer();
    },
  };
}

// The probe is a broadcast, which reaches a socket bound to every address and
// none bound to one. So each simulator hears it on a socket bound to every
// address, sharing the port with the other simulators, and answers from a
// second socket bound to its own address: the reply then comes from that
// address, and a probe sent to that address alone reaches that simulator
// alone. An adapter answers the address and port the probe came from.
async function startDiscoverySockets(
  address: string,
  reply: () => string,
): Promise<Socket[]> {
  const own = createSocket({ type: "udp4", reuseAddr: true });
  const every = createSocket({ type: "udp4", reuseAddr: true });
  const sockets = [own, every];
  for (const socket of sockets) {
    socket.on("message", (message, remote) => {
      if (message.toString("utf8") === DAIKIN_DISCOVERY_PROBE) {
        // Without a callback, a reply that fails to send is emitted as an
        // `error` nothing listens for.
        own.send(reply(), remote.port, remote.address, () => {});
      }
    });
  }
  try {
    own.bind(DAIKIN_DISCOVERY_PORT, address);
    // `once` rejects when the socket emits `error` first, as it does for a
    // port another program holds.
    await once(own, "listening");
    every.bind(DAIKIN_DISCOVERY_PORT);
    await once(every, "listening");
  } catch (error) {
    await Promise.all(sockets.map(closeSocket));
    throw error;
  }
  return sockets;
}

async function closeSocket(socket: Socket): Promise<void> {
  socket.close();
  await once(socket, "close");
}

function sleep(delayInMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayInMs));
}
