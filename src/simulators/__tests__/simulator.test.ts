import { createSocket } from "node:dgram";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseClassicKeyValue } from "../../codecs/classic/keyValue.js";
import { parseDevice } from "../../codecs/device.js";
import { startClassicSimulator } from "../classic.js";
import { startDsiotSimulator } from "../dsiot.js";
import type { DaikinSimulator } from "../simulator.js";

const DISCOVERY_PROBE = "DAIKIN_UDP/common/basic_info";
const DISCOVERY_PORT = 30050;

// An address of this machine other than loopback, when it has one.
const OTHER_ADDRESS = Object.values(networkInterfaces())
  .flat()
  .find((each) => each?.family === "IPv4" && !each.internal)?.address;

const simulators: DaikinSimulator[] = [];

afterEach(async () => {
  await Promise.all(simulators.splice(0).map((simulator) => simulator.stop()));
});

function started<SimulatorT extends DaikinSimulator>(
  simulator: SimulatorT,
): SimulatorT {
  simulators.push(simulator);
  return simulator;
}

function portOf(simulator: DaikinSimulator): string {
  return simulator.host.slice(simulator.host.indexOf(":") + 1);
}

/** Sends each datagram to the discovery port of `address`, from one socket,
 * and resolves with the first reply and where it came from. A broadcast would
 * reach every adapter on the LAN. */
async function probeAt(
  address: string,
  ...datagrams: string[]
): Promise<{ reply: string; address: string; port: number }> {
  const socket = createSocket("udp4");
  try {
    for (const datagram of datagrams) {
      socket.send(datagram, DISCOVERY_PORT, address);
    }
    const [reply, remote] = (await once(socket, "message")) as [
      Buffer,
      { address: string; port: number },
    ];
    return { reply: reply.toString("utf8"), ...remote };
  } finally {
    socket.close();
  }
}

async function probe(...datagrams: string[]): Promise<string> {
  return (await probeAt("127.0.0.1", ...datagrams)).reply;
}

/** Resolves once nothing holds the discovery port, and rejects otherwise. */
async function holdDiscoveryPort(): Promise<() => Promise<void>> {
  const socket = createSocket("udp4");
  socket.bind(DISCOVERY_PORT);
  await once(socket, "listening");
  return async () => {
    socket.close();
    await once(socket, "close");
  };
}

describe("a simulator", () => {
  describe("with a reply delay", () => {
    it("answers one request at a time, each after the delay", async () => {
      const simulator = started(
        await startClassicSimulator({ replyDelayInMs: 50 }),
      );
      const startedAtInMs = performance.now();
      const elapsedInMs = async (pathAndQuery: string) => {
        await fetch(`http://${simulator.host}${pathAndQuery}`);
        return performance.now() - startedAtInMs;
      };

      const [first, second] = await Promise.all([
        elapsedInMs("/common/set_led?led=0"),
        elapsedInMs("/common/basic_info"),
      ]);

      // A timer may fire a millisecond early.
      expect(Math.min(first, second)).toBeGreaterThanOrEqual(45);
      expect(Math.max(first, second)).toBeGreaterThanOrEqual(95);
    });

    it("never answers a request that is waiting when it stops", async () => {
      const simulator = started(
        await startClassicSimulator({ replyDelayInMs: 1_000 }),
      );

      const request = fetch(`http://${simulator.host}/common/basic_info`);
      while (simulator.requests.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      await simulator.stop();

      await expect(request).rejects.toThrow();
    });
  });

  describe("that answers discovery", () => {
    it("answers the probe with a classic adapter's basic_info and its HTTP port", async () => {
      const simulator = started(
        await startClassicSimulator({
          answersDiscovery: true,
          key: "0123456789012",
          localPassword: "1234",
        }),
      );

      const reply = await probe(DISCOVERY_PROBE);

      expect(reply).toBe(
        `ret=OK,type=aircon,reg=th,ver=1_2_51,name=Simulator,icon=0,method=home only,adp_kind=4,cpv=3,cpv_minor=20,led=1,mac=02DA1C000001,en_hol=0,grp_name=,en_grp=0,lpw_flag=1,en_secure=1,api_port=${portOf(simulator)}`,
      );
      expect(parseDevice("127.0.0.1", parseClassicKeyValue(reply))).toEqual({
        host: simulator.host,
        protocol: "classic",
        requiresRegistration: true,
        usesHttps: false,
        requiresLocalPassword: true,
        name: "Simulator",
        macAddress: "02:DA:1C:00:00:01",
        firmwareVersion: "1.2.51",
      });
    });

    it("answers the probe as a DSIOT adapter, type=GPF, with its name percent-encoded", async () => {
      const simulator = started(
        await startDsiotSimulator({
          answersDiscovery: true,
          leaves: { "/dsiot/edge.adp_d.name": { pv: "Living Room", pt: 2 } },
        }),
      );

      const reply = await probe(DISCOVERY_PROBE);

      expect(reply).toBe(
        `ret=OK,type=GPF,reg=th,ver=2_8_0,mac=02DA1C000002,adp_kind=4,name=Living%20Room,lpw_flag=0,api_port=${portOf(simulator)}`,
      );
      expect(parseDevice("127.0.0.1", parseClassicKeyValue(reply))).toEqual({
        host: simulator.host,
        protocol: "dsiot",
        requiresRegistration: false,
        usesHttps: false,
        requiresLocalPassword: false,
        name: "Living Room",
        macAddress: "02:DA:1C:00:00:02",
        firmwareVersion: "2.8.0",
      });
    });

    it("answers no other datagram", async () => {
      started(await startClassicSimulator({ answersDiscovery: true }));

      const reply = await probe("DAIKIN_UDP/common/reboot", DISCOVERY_PROBE);

      expect(reply).toContain("type=aircon");
    });

    it("answers from UDP port 30050 of its address", async () => {
      started(await startClassicSimulator({ answersDiscovery: true }));

      expect(await probeAt("127.0.0.1", DISCOVERY_PROBE)).toMatchObject({
        address: "127.0.0.1",
        port: DISCOVERY_PORT,
      });
    });

    it("shares the discovery port with another simulator", async () => {
      started(await startClassicSimulator({ answersDiscovery: true }));
      started(await startDsiotSimulator({ answersDiscovery: true }));

      expect(await probe(DISCOVERY_PROBE)).toContain("ret=OK");
    });

    it.skipIf(OTHER_ADDRESS === undefined)(
      "answers a probe sent to its own address, beside a simulator at another",
      async () => {
        const other = OTHER_ADDRESS ?? "";
        const loopback = started(
          await startClassicSimulator({ answersDiscovery: true }),
        );
        const elsewhere = started(
          await startDsiotSimulator({ answersDiscovery: true, address: other }),
        );

        const [atLoopback, atOther] = [
          await probeAt("127.0.0.1", DISCOVERY_PROBE),
          await probeAt(other, DISCOVERY_PROBE),
        ];

        expect(elsewhere.host).toBe(`${other}:${portOf(elsewhere)}`);
        expect(atLoopback).toMatchObject({ address: "127.0.0.1" });
        expect(atLoopback.reply).toContain(`api_port=${portOf(loopback)}`);
        expect(atOther).toMatchObject({ address: other });
        expect(atOther.reply).toContain(`api_port=${portOf(elsewhere)}`);
      },
    );

    it("rejects with the socket's error while another program holds the port", async () => {
      const release = await holdDiscoveryPort();

      try {
        await expect(
          startClassicSimulator({ answersDiscovery: true }),
        ).rejects.toMatchObject({
          // Windows refuses a socket that sets `reuseAddr` a port held by one
          // that does not, and calls that EACCES.
          code: process.platform === "win32" ? "EACCES" : "EADDRINUSE",
        });
      } finally {
        await release();
      }
    });

    it("frees the port when it stops", async () => {
      const simulator = started(
        await startClassicSimulator({ answersDiscovery: true }),
      );

      await simulator.stop();

      await (await holdDiscoveryPort())();
    });
  });

  it("holds no discovery port unless asked to answer discovery", async () => {
    started(await startClassicSimulator());

    await (await holdDiscoveryPort())();
  });

  describe("address", () => {
    it("is 127.0.0.1 by default", async () => {
      const simulator = started(await startClassicSimulator());

      expect(simulator.host).toMatch(/^127\.0\.0\.1:\d+$/);
    });

    it("rejects with the server's error for an address the machine does not have", async () => {
      await expect(
        startClassicSimulator({ address: "192.0.2.1" }),
      ).rejects.toMatchObject({ code: "EADDRNOTAVAIL" });
    });
  });
});
