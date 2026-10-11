import { createSocket } from "node:dgram";
import { parseClassicKeyValue } from "./codecs/classic/keyValue.js";
import { parseDevice } from "./codecs/device.js";
import type { DaikinDevice } from "./models/device.js";

// The UDP discovery probe: broadcast this to :30050, listen for `basic_info`
// replies.
const DISCOVERY_PROBE = "DAIKIN_UDP/common/basic_info";
const DISCOVERY_SEND_PORT = 30000;
const DISCOVERY_LISTEN_PORT = 30050;

const DEFAULT_DISCOVERY_TIMEOUT_IN_MS = 3_000;
const BROADCAST_ADDRESS = "255.255.255.255";
// UDP drops packets, so the probe goes out 10 times, 200 ms apart.
const PROBE_COUNT = 10;
const PROBE_INTERVAL_IN_MS = 200;

export interface DiscoverDevicesOptions {
  /** How long to listen for replies, in milliseconds. Defaults to 3000. */
  timeoutInMs?: number;
}

/** Finds the adapters on the LAN: broadcasts `DAIKIN_UDP/common/basic_info` to
 * UDP port 30050 and collects the `basic_info` replies, which carry the same
 * `key=value` payload as the HTTP `/common/basic_info`. Classic and DSIOT
 * adapters both answer, and `parseDevice` picks the protocol from the reply.
 *
 * It resolves once `timeoutInMs` has passed, never earlier, with one device
 * per replying address. It binds UDP port 30000, and rejects with the socket's
 * error when the socket fails. */
export async function discoverDevices(
  options: DiscoverDevicesOptions = {},
): Promise<DaikinDevice[]> {
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  const devices = new Map<string, DaikinDevice>();

  return new Promise((resolve, reject) => {
    let probesSent = 0;
    let probeTimer: NodeJS.Timeout | undefined;

    const listenTimer = setTimeout(() => {
      clearInterval(probeTimer);
      socket.close();
      resolve([...devices.values()]);
    }, options.timeoutInMs ?? DEFAULT_DISCOVERY_TIMEOUT_IN_MS);

    socket.on("error", (error) => {
      clearInterval(probeTimer);
      // A socket throws when it is closed twice, so the timer must not fire.
      clearTimeout(listenTimer);
      socket.close();
      reject(error);
    });

    socket.on("message", (message, remote) => {
      if (devices.has(remote.address)) {
        return;
      }
      const fields = parseClassicKeyValue(message.toString("utf8"));
      devices.set(remote.address, parseDevice(remote.address, fields));
    });

    socket.bind(DISCOVERY_SEND_PORT, () => {
      socket.setBroadcast(true);
      const probe = Buffer.from(DISCOVERY_PROBE, "utf8");
      const sendProbe = () => {
        socket.send(probe, DISCOVERY_LISTEN_PORT, BROADCAST_ADDRESS);
        probesSent += 1;
        if (probesSent >= PROBE_COUNT) {
          clearInterval(probeTimer);
        }
      };
      sendProbe();
      probeTimer = setInterval(sendProbe, PROBE_INTERVAL_IN_MS);
    });
  });
}
