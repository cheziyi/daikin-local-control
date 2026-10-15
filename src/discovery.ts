import { createSocket, type Socket } from "node:dgram";
import { once } from "node:events";
import { isAirbaseAdapter } from "./clients/airbase.js";
import {
  isClassicOk,
  parseClassicKeyValue,
} from "./codecs/classic/keyValue.js";
import { isAirConditioner, parseDevice } from "./codecs/device.js";
import type { DaikinDevice } from "./models/device.js";
import { DaikinTransport } from "./transport.js";

// The UDP discovery probe: broadcast this to :30050, listen for `basic_info`
// replies.
const DISCOVERY_PROBE = "DAIKIN_UDP/common/basic_info";
const DISCOVERY_LISTEN_PORT = 30050;
// An adapter answers the port a probe came from. The probe leaves from the
// first of these ports that is free: see DESIGN.md#discovery.
const FIRST_DISCOVERY_SEND_PORT = 30000;
const LAST_DISCOVERY_SEND_PORT = 30050;

const DEFAULT_DISCOVERY_TIMEOUT_IN_MS = 3_000;
const BROADCAST_ADDRESS = "255.255.255.255";
// UDP drops packets, so the probe goes out 10 times, 200 ms apart.
const PROBE_COUNT = 10;
const PROBE_INTERVAL_IN_MS = 200;
// How long each of the HTTP requests that tell an Airbase adapter from a
// classic one may take. An adapter that takes longer is reported as classic,
// so this only bounds how long after `timeoutInMs` a discovery resolves.
const IDENTIFY_TIMEOUT_IN_MS = 3_000;

export interface DiscoverDevicesOptions {
  /** How long to listen for replies, in milliseconds. Defaults to 3000. */
  timeoutInMs?: number;
}

/** Finds the air conditioners' adapters on the LAN: broadcasts
 * `DAIKIN_UDP/common/basic_info` to UDP port 30050 and collects the
 * `basic_info` replies, which carry the same `key=value` payload as the HTTP
 * `/common/basic_info`. Classic and DSIOT adapters both answer, and
 * `parseDevice` picks the protocol from the reply. Anything on the LAN can
 * send to the port it listens on, so it ignores a datagram whose `ret` is not
 * `OK`. The adapter of another appliance answers the probe as well, such as an
 * air cleaner's, so it ignores a reply `isAirConditioner` does not pass.
 *
 * An Airbase adapter replies as a classic adapter does, so it sends each
 * adapter that replies as one an HTTP request, or two, to tell which it is:
 * an Airbase adapter answers HTTP 404 at `/common/basic_info` and `ret=OK`
 * at `/skyfi/common/basic_info`. An adapter that does not answer in 3000 ms
 * is reported as classic. An Airbase adapter takes no registration and no
 * local password, so its device requires neither, whatever its reply says.
 *
 * It resolves once `timeoutInMs` has passed and each of those requests has
 * finished, never earlier, with one device for each `host` that replied: the
 * address a reply came from, with the port the reply announces. It binds the
 * first free UDP port from 30000 to 30050, and rejects with the socket's
 * error when none is free or the socket fails. */
export async function discoverDevices(
  options: DiscoverDevicesOptions = {},
): Promise<DaikinDevice[]> {
  const socket = await bindFirstFreePort();
  const devices = new Map<string, Promise<DaikinDevice>>();

  return new Promise((resolve, reject) => {
    let probesSent = 0;

    const probe = Buffer.from(DISCOVERY_PROBE, "utf8");
    const sendProbe = () => {
      socket.send(probe, DISCOVERY_LISTEN_PORT, BROADCAST_ADDRESS);
      probesSent += 1;
      if (probesSent >= PROBE_COUNT) {
        clearInterval(probeTimer);
      }
    };
    const probeTimer = setInterval(sendProbe, PROBE_INTERVAL_IN_MS);

    const listenTimer = setTimeout(() => {
      clearInterval(probeTimer);
      socket.close();
      resolve(Promise.all(devices.values()));
    }, options.timeoutInMs ?? DEFAULT_DISCOVERY_TIMEOUT_IN_MS);

    socket.on("error", (error) => {
      clearInterval(probeTimer);
      // A socket throws when it is closed twice, so the timer must not fire.
      clearTimeout(listenTimer);
      socket.close();
      reject(error);
    });

    socket.on("message", (message, remote) => {
      const fields = parseClassicKeyValue(message.toString("utf8"));
      if (!isClassicOk(fields) || !isAirConditioner(fields)) {
        return;
      }
      // An adapter answers each of the probes, so the first reply from a
      // host is kept. Adapters at one address, as simulators on one machine
      // are, differ by the port they announce.
      const device = parseDevice(remote.address, fields);
      if (!devices.has(device.host)) {
        devices.set(device.host, identifyProtocol(device));
      }
    });

    socket.setBroadcast(true);
    sendProbe();
  });
}

// A reply does not say whether a classic adapter is an Airbase adapter, so
// the adapter is asked over HTTP.
async function identifyProtocol(device: DaikinDevice): Promise<DaikinDevice> {
  if (device.protocol !== "classic") {
    return device;
  }
  const transport = new DaikinTransport({
    host: device.host,
    usesHttps: device.usesHttps,
    timeoutInMs: IDENTIFY_TIMEOUT_IN_MS,
  });
  try {
    // `parseDevice` read the reply as a classic adapter's, which may require
    // registration or a local password. An Airbase adapter takes neither.
    // `usesHttps` stays: the adapter has just answered over that scheme.
    return (await isAirbaseAdapter(transport))
      ? {
          ...device,
          protocol: "airbase",
          requiresRegistration: false,
          requiresLocalPassword: false,
        }
      : device;
  } finally {
    await transport.dispose();
  }
}

// Binds without `reuseAddr`: with it, a second socket binds a port that is
// held, and each reply then reaches one of the two alone.
async function bindFirstFreePort(): Promise<Socket> {
  for (let port = FIRST_DISCOVERY_SEND_PORT; ; port += 1) {
    const socket = createSocket("udp4");
    try {
      socket.bind(port);
      // `once` rejects when the socket emits `error` first, as it does for a
      // port that is held.
      await once(socket, "listening");
      return socket;
    } catch (error) {
      socket.close();
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
        port === LAST_DISCOVERY_SEND_PORT
      ) {
        throw error;
      }
    }
  }
}
