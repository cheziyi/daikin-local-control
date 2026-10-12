import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INDOOR_STATUS,
  modeLeaf,
} from "../../codecs/dsiot/__tests__/fixtures/indoorStatus.js";
import {
  buildDsiotMultireqGet,
  buildDsiotMultireqUpdate,
  DSIOT_TARGETS,
} from "../../codecs/dsiot/multireq.js";
import { DSIOT_PATHS } from "../../codecs/dsiot/state.js";
import { DaikinConnectionError, DaikinError } from "../../error.js";
import { DsiotDaikinClient } from "../dsiot.js";
import { failingFirst, MockDaikinTransport } from "./mocks/transport.js";

const MULTIREQ = "/dsiot/multireq";

interface Node {
  pn: string;
  pt?: number;
  pv?: string;
  pch?: Node[];
  md?: Record<string, string | number>;
}

type Leaf =
  | string
  | { pv: string; pt?: number; md?: Record<string, string | number> };

// Builds a reply's tree from dotted path -> pv (or { pv, md }).
function tree(leaves: Record<string, Leaf>): Node | undefined {
  const roots: Node[] = [];
  for (const [path, leaf] of Object.entries(leaves)) {
    let siblings = roots;
    let node: Node | undefined;
    for (const name of path.split(".")) {
      node = siblings.find((candidate) => candidate.pn === name);
      if (!node) {
        node = { pn: name };
        siblings.push(node);
      }
      node.pch ??= [];
      siblings = node.pch;
    }
    if (node) {
      delete node.pch;
      Object.assign(node, typeof leaf === "string" ? { pv: leaf } : leaf);
    }
  }
  return roots[0];
}

// The reply to a read: one answered request per tree.
function read(...leaves: Record<string, Leaf>[]): string {
  return JSON.stringify({
    responses: leaves.map((each) => ({ rsc: 2000, pc: tree(each) })),
  });
}

const WRITTEN = JSON.stringify({ responses: [{ rsc: 2004 }] });

// Answers every read with `reply` and every write with `WRITTEN`.
function adapter(reply: string): MockDaikinTransport {
  return new MockDaikinTransport(({ method }) =>
    method === "PUT" ? WRITTEN : reply,
  );
}

function dsiotClient(transport: MockDaikinTransport): DsiotDaikinClient {
  return new DsiotDaikinClient(transport.asTransport());
}

function methodsSentTo(transport: MockDaikinTransport): string[] {
  return transport.sent.map(({ method }) => method);
}

describe("DsiotDaikinClient", () => {
  describe("getState", () => {
    it("posts a read of the indoor and outdoor status and parses it into a DaikinState", async () => {
      const transport = adapter(
        read(INDOOR_STATUS, { "dgc_status.e_1003.e_3002.p_44": "01" }),
      );

      expect(await dsiotClient(transport).getState()).toEqual({
        power: false,
        mode: "cool",
        targetTemperatureInC: 24,
        targetHumidity: null,
        fanSpeed: "auto",
        swingMode: "vertical",
        verticalPosition: "swing",
        horizontalPosition: "stop",
        specialModes: ["powerful"],
      });
      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([
            DSIOT_TARGETS.indoorStatus,
            DSIOT_TARGETS.outdoorStatus,
          ]),
        },
      ]);
    });
  });

  describe("setState", () => {
    it("reads the indoor status, then puts every changed leaf in one write", async () => {
      const transport = adapter(read(INDOOR_STATUS));

      await dsiotClient(transport).setState({
        power: true,
        mode: "heat",
        targetTemperatureInC: 22,
        fanSpeed: "level3",
        swingMode: "off",
      });

      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([DSIOT_TARGETS.indoorStatus]),
        },
        {
          method: "PUT",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqUpdate([
            { path: DSIOT_PATHS.power, value: "01" },
            { path: DSIOT_PATHS.powerTransition, value: "00" },
            { path: DSIOT_PATHS.mode, value: "0100" },
            { path: modeLeaf("p_03"), value: "2c" },
            { path: modeLeaf("p_0A"), value: "0500" },
            { path: modeLeaf("p_07"), value: "000000" },
            { path: modeLeaf("p_08"), value: "000000" },
          ]),
        },
      ]);
    });

    it("applies the control to the metadata it read with the status", async () => {
      const transport = adapter(
        read({
          ...INDOOR_STATUS,
          [modeLeaf("p_0B")]: { pv: "0A", md: { st: 5 } },
          [modeLeaf("p_0C")]: "01",
        }),
      );
      const client = dsiotClient(transport);

      expect((await client.getState()).targetHumidity).toEqual({ percent: 50 });

      await client.setState({ targetHumidity: { percent: 60 } });

      expect(transport.sent.at(-1)?.jsonBody).toEqual(
        buildDsiotMultireqUpdate([
          { path: DSIOT_PATHS.power, value: "00" },
          { path: DSIOT_PATHS.powerTransition, value: "02" },
          { path: DSIOT_PATHS.mode, value: "0200" },
          { path: modeLeaf("p_0C"), value: "01" },
          { path: modeLeaf("p_0B"), value: "0C" },
          { path: modeLeaf("p_09"), value: "0A00" },
        ]),
      );
    });

    it("reads the indoor status again after getState, without a maxStateAgeForSetStateInMs", async () => {
      const transport = adapter(read(INDOOR_STATUS));
      const client = dsiotClient(transport);

      await client.getState();
      await client.setState({ power: true });

      expect(methodsSentTo(transport)).toEqual(["POST", "POST", "PUT"]);
    });

    describe("with a maxStateAgeForSetStateInMs", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      function reusingClient(
        transport: MockDaikinTransport,
      ): DsiotDaikinClient {
        vi.useFakeTimers();
        return new DsiotDaikinClient(
          transport.asTransport(),
          undefined,
          60_000,
        );
      }

      it("applies the control to the status getState read, without reading again", async () => {
        const transport = adapter(read(INDOOR_STATUS));
        const client = reusingClient(transport);

        await client.getState();
        vi.advanceTimersByTime(59_999);
        await client.setState({ power: true, targetTemperatureInC: 22 });

        expect(methodsSentTo(transport)).toEqual(["POST", "PUT"]);
        expect(transport.sent.at(-1)?.jsonBody).toEqual(
          buildDsiotMultireqUpdate([
            { path: DSIOT_PATHS.power, value: "01" },
            { path: DSIOT_PATHS.powerTransition, value: "00" },
            { path: DSIOT_PATHS.mode, value: "0200" },
            { path: modeLeaf("p_02"), value: "2c" },
          ]),
        );
      });

      it("applies the control to the status getStateAndSensors read", async () => {
        const transport = adapter(read(INDOOR_STATUS));
        const client = reusingClient(transport);

        await client.getStateAndSensors();
        await client.setState({ power: true });

        expect(methodsSentTo(transport)).toEqual(["POST", "PUT"]);
      });

      it("reads the indoor status again once the reply is that old", async () => {
        const transport = adapter(read(INDOOR_STATUS));
        const client = reusingClient(transport);

        await client.getState();
        vi.advanceTimersByTime(60_000);
        await client.setState({ power: true });

        expect(methodsSentTo(transport)).toEqual(["POST", "POST", "PUT"]);
      });

      it("reads the indoor status again for the write after a write", async () => {
        const transport = adapter(read(INDOOR_STATUS));
        const client = reusingClient(transport);

        await client.getState();
        await client.setState({ mode: "heat" });
        await client.setState({ targetTemperatureInC: 22 });

        expect(methodsSentTo(transport)).toEqual([
          "POST",
          "PUT",
          "POST",
          "PUT",
        ]);
      });

      it("reads the indoor status again after multireqUpdate", async () => {
        const transport = adapter(read(INDOOR_STATUS));
        const client = reusingClient(transport);

        await client.getState();
        await client.multireqUpdate([{ path: DSIOT_PATHS.power, value: "01" }]);
        await client.setState({ power: false });

        expect(methodsSentTo(transport)).toEqual([
          "POST",
          "PUT",
          "POST",
          "PUT",
        ]);
      });
    });
  });

  describe("getStateAndSensors", () => {
    it("parses the state and the sensors from one read of the indoor and outdoor status", async () => {
      const transport = adapter(
        read(INDOOR_STATUS, { [DSIOT_PATHS.outdoorTemperature]: "3E00" }),
      );

      expect(await dsiotClient(transport).getStateAndSensors()).toEqual({
        state: {
          power: false,
          mode: "cool",
          targetTemperatureInC: 24,
          targetHumidity: null,
          fanSpeed: "auto",
          swingMode: "vertical",
          verticalPosition: "swing",
          horizontalPosition: "stop",
          specialModes: [],
        },
        sensors: {
          indoorTemperatureInC: 26,
          indoorHumidityInPercent: 55,
          outdoorTemperatureInC: 31,
        },
      });
      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([
            DSIOT_TARGETS.indoorStatus,
            DSIOT_TARGETS.outdoorStatus,
          ]),
        },
      ]);
    });
  });

  describe("getDeviceInfo", () => {
    it("reads the adapter info", async () => {
      const transport = adapter(
        read({ "adp_i.mac": "A408EACC91D4", "adp_i.ver": "1_14_88" }),
      );

      expect(await dsiotClient(transport).getDeviceInfo()).toEqual({
        macAddress: "A4:08:EA:CC:91:D4",
        firmwareVersion: "1.14.88",
      });
      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([DSIOT_TARGETS.adapterInfo]),
        },
      ]);
    });
  });

  describe("getSensors", () => {
    it("reads the indoor and outdoor status", async () => {
      const transport = adapter(
        read(INDOOR_STATUS, { [DSIOT_PATHS.outdoorTemperature]: "3D00" }),
      );

      expect(await dsiotClient(transport).getSensors()).toEqual({
        indoorTemperatureInC: 26,
        indoorHumidityInPercent: 55,
        outdoorTemperatureInC: 30.5,
      });
      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([
            DSIOT_TARGETS.indoorStatus,
            DSIOT_TARGETS.outdoorStatus,
          ]),
        },
      ]);
    });
  });

  describe("getCapabilities", () => {
    it("reads the adapter info and the indoor and outdoor status, with their metadata", async () => {
      const transport = adapter(
        read(
          { "adp_i.reg": "sg", "adp_i.kind": "4" },
          {
            ...INDOOR_STATUS,
            [modeLeaf("p_02")]: { pv: "3000", md: { mi: "2400", mx: "3800" } },
          },
          { "dgc_status.e_1003.e_3002.p_44": { pv: "00", pt: 2 } },
        ),
      );

      const capabilities = await dsiotClient(transport).getCapabilities();

      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([
            DSIOT_TARGETS.adapterInfo,
            DSIOT_TARGETS.indoorStatus,
            DSIOT_TARGETS.outdoorStatus,
          ]),
        },
      ]);
      expect(capabilities.specialModes.cool).toEqual(["powerful"]);
      expect(capabilities.targetTemperaturesInC.cool).toEqual({
        min: 18,
        max: 28,
        step: 0.5,
      });
      expect(capabilities.targetTemperaturesInC.dehumidify).toBeNull();
      expect(capabilities.fanSpeeds).toContain("level5");
      expect(capabilities.swingModes).toEqual([
        "off",
        "vertical",
        "horizontal",
        "both",
      ]);
    });
  });

  describe("reboot", () => {
    it("sends one POST to /config/system/reboot", async () => {
      const transport = new MockDaikinTransport(() => "");

      await dsiotClient(transport).reboot();

      expect(transport.sent).toStrictEqual([
        { method: "POST", path: "/config/system/reboot" },
      ]);
    });

    it("is not sent again after a dropped connection", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(
        failingFirst(1, dropped, () => ""),
      );

      await expect(dsiotClient(transport).reboot()).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(1);
    });
  });

  describe("multireqGet", () => {
    it("posts a read of the targets and returns the reply flattened", async () => {
      const transport = adapter(read({ "adp_i.reg": "sg" }));

      expect(
        await dsiotClient(transport).multireqGet([DSIOT_TARGETS.adapterInfo]),
      ).toEqual({ "adp_i.reg": "sg" });
      expect(transport.sent).toStrictEqual([
        {
          method: "POST",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqGet([DSIOT_TARGETS.adapterInfo]),
        },
      ]);
    });

    it("throws a DaikinError with status 401 when the adapter rejects the credentials", async () => {
      const transport = adapter(JSON.stringify({ responses: [{ rsc: 4001 }] }));

      await expect(
        dsiotClient(transport).multireqGet([DSIOT_TARGETS.indoorStatus]),
      ).rejects.toMatchObject({ httpStatusCode: 401 });
      expect(transport.sent).toHaveLength(1);
    });

    it("sends the request again after a dropped connection", async () => {
      const transport = new MockDaikinTransport(
        failingFirst(1, new DaikinConnectionError("closed"), () =>
          read(INDOOR_STATUS),
        ),
      );

      await dsiotClient(transport).multireqGet([DSIOT_TARGETS.indoorStatus]);

      expect(transport.sent).toHaveLength(2);
    });

    it("does not send the request again after a timeout", async () => {
      const timedOut = new DaikinError("timed out", 504);
      const transport = new MockDaikinTransport(
        failingFirst(1, timedOut, () => read(INDOOR_STATUS)),
      );

      await expect(
        dsiotClient(transport).multireqGet([DSIOT_TARGETS.indoorStatus]),
      ).rejects.toBe(timedOut);
      expect(transport.sent).toHaveLength(1);
    });

    it("sends once when retry is false", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(
        failingFirst(1, dropped, () => read(INDOOR_STATUS)),
      );

      await expect(
        dsiotClient(transport).multireqGet([DSIOT_TARGETS.indoorStatus], {
          retry: false,
        }),
      ).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(1);
    });
  });

  describe("multireqUpdate", () => {
    const updates = [{ path: DSIOT_PATHS.power, value: "01" }];

    it("puts the leaves in one tree and returns the reply flattened", async () => {
      const transport = adapter(WRITTEN);

      expect(await dsiotClient(transport).multireqUpdate(updates)).toEqual({});
      expect(transport.sent).toStrictEqual([
        {
          method: "PUT",
          path: MULTIREQ,
          jsonBody: buildDsiotMultireqUpdate(updates),
        },
      ]);
    });

    it("sends the request again after a dropped connection", async () => {
      const transport = new MockDaikinTransport(
        failingFirst(1, new DaikinConnectionError("closed"), () => WRITTEN),
      );

      await dsiotClient(transport).multireqUpdate(updates);

      expect(transport.sent).toHaveLength(2);
    });

    it("sends once when retry is false", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(
        failingFirst(1, dropped, () => WRITTEN),
      );

      await expect(
        dsiotClient(transport).multireqUpdate(updates, { retry: false }),
      ).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(1);
    });

    it("retries once for each of the constructor's delaysInMs", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(() => {
        throw dropped;
      });
      const client = new DsiotDaikinClient(transport.asTransport(), {
        delaysInMs: [0, 0],
      });

      await expect(client.multireqUpdate(updates)).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(3);
    });
  });

  describe("close", () => {
    it("closes its transport", async () => {
      const transport = adapter(WRITTEN);

      await dsiotClient(transport).close();

      expect(transport.closed).toBe(true);
    });
  });
});
