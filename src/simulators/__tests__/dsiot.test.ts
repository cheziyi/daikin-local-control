import { afterEach, describe, expect, it } from "vitest";
import type { DsiotDaikinClient } from "../../clients/dsiot.js";
import {
  type CreateDaikinClientOptions,
  createDaikinClient,
} from "../../factory.js";
import {
  type DsiotDaikinSimulator,
  type StartDsiotSimulatorOptions,
  startDsiotSimulator,
} from "../dsiot.js";

const TERMINAL_UUID = "0123456789abcdef0123456789abcdef";

const ADAPTER_INFO = "/dsiot/edge.adp_i";
const INDOOR_STATUS = "/dsiot/edge/adr_0100.dgc_status";
const OUTDOOR_STATUS = "/dsiot/edge/adr_0200.dgc_status";
const POWER = `${INDOOR_STATUS}.e_1002.e_A002.p_01`;
const MODE = `${INDOOR_STATUS}.e_1002.e_3001.p_01`;
const COOL_SETPOINT = `${INDOOR_STATUS}.e_1002.e_3001.p_02`;
const COOL_FAN_SPEED = `${INDOOR_STATUS}.e_1002.e_3001.p_09`;
const INDOOR_TEMPERATURE = `${INDOOR_STATUS}.e_1002.e_A00B.p_01`;
const POWERFUL = `${OUTDOOR_STATUS}.e_1003.e_3002.p_44`;

interface Node {
  pn: string;
  pt: number;
  pv?: string;
  pch?: Node[];
  md?: Record<string, string>;
}

const simulators: DsiotDaikinSimulator[] = [];
const clients: DsiotDaikinClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(simulators.splice(0).map((simulator) => simulator.stop()));
});

async function simulatorWith(
  options?: StartDsiotSimulatorOptions,
): Promise<DsiotDaikinSimulator> {
  const simulator = await startDsiotSimulator(options);
  simulators.push(simulator);
  return simulator;
}

async function send(
  simulator: DsiotDaikinSimulator,
  method: string,
  body?: unknown,
  { path = "/dsiot/multireq", authorization = "" } = {},
): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://${simulator.host}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.text() };
}

/** Reads resources as a POST of `op` 2 requests, and resolves with the tree
 * of each. */
async function read(
  simulator: DsiotDaikinSimulator,
  ...targets: string[]
): Promise<Node[]> {
  const { body } = await send(simulator, "POST", {
    requests: targets.map((to) => ({ op: 2, to })),
  });
  return (JSON.parse(body) as { responses: { pc: Node }[] }).responses.map(
    ({ pc }) => pc,
  );
}

/** The node at dotted `names` below `root`. */
function nodeAt(root: Node | undefined, names: string): Node | undefined {
  return names
    .split(".")
    .reduce(
      (node, name) => node?.pch?.find((child) => child.pn === name),
      root,
    );
}

/** A tree that sets one leaf: `names` is dotted from the resource's root. */
function treeSetting(names: string, pv: string): object {
  return names
    .split(".")
    .reduceRight<object>(
      (child, pn) =>
        "pv" in child && !("pn" in child) ? { pn, pv } : { pn, pch: [child] },
      { pv },
    );
}

function update(
  simulator: DsiotDaikinSimulator,
  to: string,
  names: string,
  pv: string,
): Promise<{ status: number; body: string }> {
  return send(simulator, "PUT", {
    requests: [{ op: 3, to, pc: treeSetting(names, pv) }],
  });
}

function clientFor(
  simulator: DsiotDaikinSimulator,
  options: Partial<CreateDaikinClientOptions> = {},
): DsiotDaikinClient {
  const client = createDaikinClient(
    { host: simulator.host, protocol: "dsiot" },
    { terminalUuid: TERMINAL_UUID, retry: { delaysInMs: [] }, ...options },
  ) as DsiotDaikinClient;
  clients.push(client);
  return client;
}

describe("startDsiotSimulator", () => {
  describe("a read", () => {
    it("answers rsc 2000 and the resource's tree, a node of pt 1 over each leaf", async () => {
      const simulator = await simulatorWith();

      const { status, body } = await send(simulator, "POST", {
        requests: [{ op: 2, to: `${ADAPTER_INFO}?filter=pv` }],
      });

      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({
        responses: [
          {
            rsc: 2000,
            pc: {
              pn: "adp_i",
              pt: 1,
              pch: [
                { pn: "kind", pt: 3, pv: "4" },
                { pn: "ver", pt: 3, pv: "2_8_0" },
                { pn: "reg", pt: 3, pv: "th" },
                { pn: "mac", pt: 3, pv: "02DA1C000002" },
                {
                  pn: "func",
                  pt: 1,
                  pch: [
                    { pn: "en_scdltmr", pt: 3, pv: "1" },
                    { pn: "en_demand", pt: 3, pv: "1" },
                    { pn: "en_ipower", pt: 3, pv: "1" },
                  ],
                },
              ],
            },
          },
        ],
      });
    });

    it("answers one tree for each request, in their order", async () => {
      const simulator = await simulatorWith();

      const trees = await read(simulator, OUTDOOR_STATUS, INDOOR_STATUS);

      expect(trees.map(({ pn }) => pn)).toEqual(["dgc_status", "dgc_status"]);
      expect(nodeAt(trees[0], "e_1003.e_A00D.p_01")?.pv).toBe("3C00");
      expect(nodeAt(trees[1], "e_1002.e_A002.p_01")?.pv).toBe("00");
    });

    it("sends md only when the filter lists it, or there is no filter", async () => {
      const simulator = await simulatorWith();
      const setpoint = "e_1002.e_3001.p_02";
      const leaf = async (to: string) =>
        nodeAt((await read(simulator, to))[0], setpoint);

      expect(await leaf(`${INDOOR_STATUS}?filter=pv`)).toEqual({
        pn: "p_02",
        pt: 2,
        pv: "3000",
      });
      expect(await leaf(`${INDOOR_STATUS}?filter=pv,pt,md`)).toEqual({
        pn: "p_02",
        pt: 2,
        pv: "3000",
        md: { pt: "b", mi: "2400", mx: "4000" },
      });
      expect(await leaf(INDOOR_STATUS)).toEqual(
        await leaf(`${INDOOR_STATUS}?filter=pv,pt,md`),
      );
      expect(await leaf(`${INDOOR_STATUS}?filter=md`)).toEqual({
        pn: "p_02",
        pt: 2,
        md: { pt: "b", mi: "2400", mx: "4000" },
      });
    });

    it("answers a leaf the caller added, changed or deleted", async () => {
      const simulator = await simulatorWith({
        leaves: { [INDOOR_TEMPERATURE]: { pv: "14", pt: 3 } },
      });
      const humidityFlag = `${INDOOR_STATUS}.e_1002.e_3001.p_0C`;

      simulator.leaves[humidityFlag] = { pv: "02", pt: 2 };
      delete simulator.leaves[COOL_FAN_SPEED];
      const [tree] = await read(simulator, INDOOR_STATUS);

      expect(nodeAt(tree, "e_1002.e_A00B.p_01")?.pv).toBe("14");
      expect(nodeAt(tree, "e_1002.e_3001.p_0C")?.pv).toBe("02");
      expect(nodeAt(tree, "e_1002.e_3001.p_09")).toBeUndefined();
    });

    it.each([
      ["a resource it has no leaf of", [{ op: 2, to: "/dsiot/edge.dev_i" }]],
      ["a node below a resource", [{ op: 2, to: `${INDOOR_STATUS}.e_1002` }]],
      ["a query that is not a filter", [{ op: 2, to: `${ADAPTER_INFO}?pv` }]],
      ["an update", [{ op: 3, to: ADAPTER_INFO }]],
      ["no request", []],
    ])("answers HTTP 501 to a POST of %s", async (_fault, requests) => {
      const simulator = await simulatorWith();

      expect((await send(simulator, "POST", { requests })).status).toBe(501);
    });
  });

  describe("a write", () => {
    it("answers rsc 2004 and holds the value", async () => {
      const simulator = await simulatorWith();

      const { status, body } = await update(
        simulator,
        INDOOR_STATUS,
        "dgc_status.e_1002.e_A002.p_01",
        "01",
      );

      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ responses: [{ rsc: 2004 }] });
      expect(simulator.leaves[POWER]?.pv).toBe("01");
    });

    it("holds a status value in upper case, at the width of the leaf", async () => {
      const simulator = await simulatorWith();

      await update(
        simulator,
        INDOOR_STATUS,
        "dgc_status.e_1002.e_3001.p_02",
        "2d",
      );

      expect(simulator.leaves[COOL_SETPOINT]?.pv).toBe("2D00");
    });

    it("holds a value outside a status tree as it is sent", async () => {
      const simulator = await simulatorWith();

      await update(simulator, "/dsiot/edge.adp_d", "adp_d.name", "Bedroom");

      expect(simulator.leaves["/dsiot/edge.adp_d.name"]?.pv).toBe("Bedroom");
    });

    it("takes the powerful leaf on the outdoor unit", async () => {
      const simulator = await simulatorWith();

      await update(
        simulator,
        OUTDOOR_STATUS,
        "dgc_status.e_1003.e_3002.p_44",
        "01",
      );

      expect(simulator.leaves[POWERFUL]?.pv).toBe("01");
    });

    it("takes the power transition and reports no such leaf", async () => {
      const simulator = await simulatorWith();

      const { status } = await update(
        simulator,
        INDOOR_STATUS,
        "dgc_status.e_1002.e_3003.p_2D",
        "00",
      );
      const [tree] = await read(simulator, INDOOR_STATUS);

      expect(status).toBe(200);
      expect(nodeAt(tree, "e_1002.e_3003.p_2D")).toBeUndefined();
    });

    it("answers HTTP 501 and holds none of a write that names a leaf it lacks", async () => {
      const simulator = await simulatorWith();

      const { status } = await send(simulator, "PUT", {
        requests: [
          {
            op: 3,
            to: INDOOR_STATUS,
            pc: {
              pn: "dgc_status",
              pch: [
                {
                  pn: "e_1002",
                  pch: [
                    { pn: "e_A002", pch: [{ pn: "p_01", pv: "01" }] },
                    { pn: "e_3001", pch: [{ pn: "p_0C", pv: "02" }] },
                  ],
                },
              ],
            },
          },
        ],
      });

      expect(status).toBe(501);
      expect(simulator.leaves[POWER]?.pv).toBe("00");
    });

    it.each([
      [
        "a tree that is not the resource in to",
        OUTDOOR_STATUS,
        "dgc_statuses.e_1003.e_3002.p_44",
      ],
      [
        "a leaf of another edge",
        INDOOR_STATUS,
        "dgc_status.e_1003.e_3002.p_44",
      ],
      [
        "a to with a filter",
        `${INDOOR_STATUS}?filter=pv`,
        "dgc_status.e_1002.e_A002.p_01",
      ],
    ])("answers HTTP 501 to a PUT of %s", async (_fault, to, names) => {
      const simulator = await simulatorWith();

      expect((await update(simulator, to, names, "01")).status).toBe(501);
    });

    it("answers HTTP 501 to a PUT of a read", async () => {
      const simulator = await simulatorWith();

      const { status } = await send(simulator, "PUT", {
        requests: [{ op: 2, to: INDOOR_STATUS }],
      });

      expect(status).toBe(501);
    });
  });

  describe("other requests", () => {
    it("answers rsc 2000 to a reboot", async () => {
      const simulator = await simulatorWith();

      const { status, body } = await send(simulator, "POST", undefined, {
        path: "/config/system/reboot",
      });

      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ rsc: 2000 });
    });

    it("answers HTTP 501 to a path or a method it does not have", async () => {
      const simulator = await simulatorWith();

      expect(
        await send(simulator, "POST", {}, { path: "/config/adapter/lpw" }),
      ).toEqual({
        status: 501,
        body: "The simulator does not answer POST /config/adapter/lpw",
      });
      expect((await send(simulator, "GET")).status).toBe(501);
    });

    it("answers HTTP 501 to a body that is not JSON", async () => {
      const simulator = await simulatorWith();

      const response = await fetch(`http://${simulator.host}/dsiot/multireq`, {
        method: "POST",
        body: "requests",
      });

      expect(response.status).toBe(501);
    });
  });

  describe("with a local password", () => {
    const requests = [{ op: 2, to: ADAPTER_INFO }];

    it("answers rsc 4001 without the code as Basic authorization", async () => {
      const simulator = await simulatorWith({ localPassword: "1234" });
      const unauthorized = { responses: [{ rsc: 4001 }] };

      const none = await send(simulator, "POST", { requests });
      const wrong = await send(
        simulator,
        "POST",
        { requests },
        {
          authorization: "Basic 0000",
        },
      );

      expect(none.status).toBe(200);
      expect(JSON.parse(none.body)).toEqual(unauthorized);
      expect(JSON.parse(wrong.body)).toEqual(unauthorized);
    });

    it("answers a request that carries the code", async () => {
      const simulator = await simulatorWith({ localPassword: "1234" });

      const { body } = await send(
        simulator,
        "POST",
        { requests },
        {
          authorization: "Basic 1234",
        },
      );

      expect(JSON.parse(body)).toMatchObject({ responses: [{ rsc: 2000 }] });
    });
  });
});

describe("DsiotDaikinClient against the simulator", () => {
  it("reads the adapter's name, MAC address and firmware version", async () => {
    const simulator = await simulatorWith();

    expect(await clientFor(simulator).getDeviceInfo()).toEqual({
      name: "Simulator",
      macAddress: "02:DA:1C:00:00:02",
      firmwareVersion: "2.8.0",
    });
  });

  it("reads the unit's capabilities", async () => {
    const simulator = await simulatorWith();

    expect(await clientFor(simulator).getCapabilities()).toEqual({
      modes: ["auto", "dehumidify", "cool", "heat", "fan"],
      fanSpeeds: [
        "auto",
        "silent",
        "level1",
        "level2",
        "level3",
        "level4",
        "level5",
      ],
      swingModes: ["off", "vertical", "horizontal", "both"],
      verticalPositions: [
        "stop",
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
        "swing",
      ],
      horizontalPositions: ["stop", "swing"],
      targetTemperaturesInC: {
        auto: { min: 18, max: 30, step: 0.5 },
        cool: { min: 18, max: 32, step: 0.5 },
        heat: { min: 10, max: 30, step: 0.5 },
        dehumidify: null,
        fan: null,
      },
      targetHumidities: {
        auto: [],
        dehumidify: [],
        cool: [],
        heat: [],
        fan: [],
      },
      specialModes: {
        auto: ["powerful", "econo", "streamer"],
        dehumidify: ["powerful", "econo", "streamer"],
        cool: ["powerful", "econo", "streamer"],
        heat: ["powerful", "econo", "streamer"],
        fan: ["powerful", "streamer"],
      },
      specialOutlet: false,
      energyMonitoring: true,
      demandControl: true,
      scheduleTimer: true,
      model: "0ABB",
    });
  });

  it("reads a cooling-only unit's modes", async () => {
    const simulator = await simulatorWith({
      leaves: {
        [`${INDOOR_STATUS}.e_1002.e_A001.p_07`]: { pv: "01", pt: 3 },
      },
    });

    expect((await clientFor(simulator).getCapabilities()).modes).toEqual([
      "dehumidify",
      "cool",
      "fan",
    ]);
  });

  it("reads the state of a unit that is off, in cool at 24 °C", async () => {
    const simulator = await simulatorWith();

    expect(await clientFor(simulator).getState()).toEqual({
      power: false,
      mode: "cool",
      targetTemperatureInC: 24,
      targetHumidity: null,
      fanSpeed: "auto",
      swingMode: "off",
      verticalPosition: "stop",
      horizontalPosition: "stop",
      specialModes: [],
    });
  });

  it("reads back the state it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({
      power: true,
      targetTemperatureInC: 22.5,
      fanSpeed: "level3",
      verticalPosition: "position3",
      horizontalPosition: "swing",
    });

    expect(await client.getState()).toEqual({
      power: true,
      mode: "cool",
      targetTemperatureInC: 22.5,
      targetHumidity: null,
      fanSpeed: "level3",
      swingMode: "horizontal",
      verticalPosition: "position3",
      horizontalPosition: "swing",
      specialModes: [],
    });
    expect(simulator.leaves[COOL_SETPOINT]?.pv).toBe("2D00");
  });

  it("returns to the values a mode held when it sets that mode again", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);
    await client.setState({ targetTemperatureInC: 22, fanSpeed: "silent" });

    await client.setState({ mode: "heat", swingMode: "both" });
    const heat = await client.getState();
    await client.setState({ mode: "cool" });
    const cool = await client.getState();

    expect(heat).toMatchObject({
      mode: "heat",
      targetTemperatureInC: 25,
      fanSpeed: "auto",
      swingMode: "both",
    });
    expect(cool).toMatchObject({
      mode: "cool",
      targetTemperatureInC: 22,
      fanSpeed: "silent",
      swingMode: "off",
    });
  });

  it("reads a change made on the simulator, as one made on the remote control", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    (simulator.leaves[POWER] ?? { pv: "" }).pv = "01";
    (simulator.leaves[MODE] ?? { pv: "" }).pv = "0100";

    expect(await client.getState()).toMatchObject({
      power: true,
      mode: "heat",
    });
  });

  it("reads the sensors, alone and with the state", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);
    const sensors = {
      indoorTemperatureInC: 26,
      outdoorTemperatureInC: 30,
      indoorHumidityInPercent: 55,
    };

    expect(await client.getSensors()).toEqual(sensors);
    expect(await client.getStateAndSensors()).toMatchObject({
      state: { mode: "cool" },
      sensors,
    });
  });

  it("reads back the special modes it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setSpecialMode("powerful", true);
    await client.setSpecialMode("econo", true);
    await client.setSpecialMode("streamer", true);
    const all = (await client.getState()).specialModes;
    await client.setSpecialMode("powerful", false);
    await client.setSpecialMode("streamer", false);

    expect(all).toEqual(["powerful", "econo", "streamer"]);
    expect((await client.getState()).specialModes).toEqual(["econo"]);
    expect(simulator.leaves[POWERFUL]?.pv).toBe("00");
  });

  it("writes any other leaf with multireqUpdate", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.multireqUpdate([
      { path: "dgc_status.e_1002.e_A002.p_01", value: "01" },
    ]);

    expect((await client.getState()).power).toBe(true);
  });

  it("reboots", async () => {
    const simulator = await simulatorWith();

    await clientFor(simulator).reboot();

    expect(simulator.requests).toMatchObject([
      { method: "POST", path: "/config/system/reboot" },
    ]);
  });

  it("is rejected with status 401 without the local password", async () => {
    const simulator = await simulatorWith({ localPassword: "1234" });

    await expect(clientFor(simulator).getState()).rejects.toMatchObject({
      httpStatusCode: 401,
    });
    expect(
      (await clientFor(simulator, { localPassword: "1234" }).getState()).mode,
    ).toBe("cool");
  });

  it("is rejected with status 501 for a resource the simulator does not have", async () => {
    const simulator = await simulatorWith();

    await expect(
      clientFor(simulator).multireqGet(["/dsiot/edge.dev_i?filter=pv"]),
    ).rejects.toMatchObject({ httpStatusCode: 501 });
  });
});
