import { afterEach, describe, expect, it } from "vitest";
import type { DaikinClient } from "../../clients/client.js";
import { createDaikinClient } from "../../factory.js";
import type { DaikinProtocol } from "../../models/device.js";
import type { DaikinState } from "../../models/state.js";
import { startClassicSimulator } from "../classic.js";
import { startDsiotSimulator } from "../dsiot.js";
import type {
  DaikinSimulator,
  DaikinSimulatorUnit,
  StartSimulatorOptions,
} from "../simulator.js";

// What a simulator is told in the package's models, read back through a
// client of its protocol.

const TERMINAL_UUID = "0123456789abcdef0123456789abcdef";

const simulators: DaikinSimulator[] = [];
const clients: DaikinClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(simulators.splice(0).map((simulator) => simulator.stop()));
});

function started<SimulatorT extends DaikinSimulator>(
  simulator: SimulatorT,
): SimulatorT {
  simulators.push(simulator);
  return simulator;
}

function clientFor(
  simulator: DaikinSimulator,
  protocol: DaikinProtocol,
): DaikinClient {
  const client = createDaikinClient(
    { host: simulator.host, protocol },
    { terminalUuid: TERMINAL_UUID, retry: { delaysInMs: [] } },
  );
  clients.push(client);
  return client;
}

describe.each([
  ["classic", startClassicSimulator],
  ["dsiot", startDsiotSimulator],
] as const)("a %s simulator", (protocol, start) => {
  const unitWith = async (
    options: StartSimulatorOptions & { unit?: DaikinSimulatorUnit },
  ) => {
    const simulator = started(await start(options));
    return { simulator, client: clientFor(simulator, protocol) };
  };

  describe("deviceInfo", () => {
    it("is what getDeviceInfo reads", async () => {
      const deviceInfo = {
        name: "Séjour, 1=2",
        macAddress: "A4:08:EA:CC:91:D4",
        firmwareVersion: "3.12.0",
      };

      const { client } = await unitWith({ deviceInfo });

      expect(await client.getDeviceInfo()).toEqual(deviceInfo);
    });

    it("keeps the default of a field left out", async () => {
      const { client } = await unitWith({ deviceInfo: { name: "Bedroom" } });

      expect(await client.getDeviceInfo()).toMatchObject({
        name: "Bedroom",
        macAddress: expect.stringMatching(/^02:DA:1C/),
      });
    });
  });

  describe("state", () => {
    it("is what getState reads", async () => {
      const state: Partial<DaikinState> = {
        power: true,
        mode: "heat",
        targetTemperatureInC: 21,
        fanSpeed: "level2",
        swingMode: "vertical",
        specialModes: ["econo", "streamer"],
      };

      const { client } = await unitWith({ state });

      expect(await client.getState()).toMatchObject(state);
    });

    it("changes with setState, as a change on the remote control", async () => {
      const { simulator, client } = await unitWith({});

      simulator.setState({ power: true, fanSpeed: "silent" });

      expect(await client.getState()).toMatchObject({
        power: true,
        mode: "cool",
        targetTemperatureInC: 24,
        fanSpeed: "silent",
      });
    });

    it("leaves a field that is left out or null as the unit holds it", async () => {
      const { simulator, client } = await unitWith({
        state: { targetTemperatureInC: 22 },
      });

      simulator.setState({ targetTemperatureInC: null, power: true });

      expect(await client.getState()).toMatchObject({
        power: true,
        targetTemperatureInC: 22,
      });
    });

    it("takes up what the unit remembers for a mode it is set to", async () => {
      const { simulator, client } = await unitWith({
        state: { targetTemperatureInC: 22, fanSpeed: "level4" },
      });

      simulator.setState({ mode: "heat" });
      const heat = await client.getState();
      simulator.setState({ mode: "cool" });
      const cool = await client.getState();

      expect(heat).toMatchObject({
        mode: "heat",
        targetTemperatureInC: 25,
        fanSpeed: "auto",
      });
      expect(cool).toMatchObject({
        mode: "cool",
        targetTemperatureInC: 22,
        fanSpeed: "level4",
      });
    });

    it("applies the other fields to the mode it is set to", async () => {
      const { simulator, client } = await unitWith({});

      simulator.setState({ mode: "heat", targetTemperatureInC: 19.5 });

      expect(await client.getState()).toMatchObject({
        mode: "heat",
        targetTemperatureInC: 19.5,
      });
    });

    it("reads no setpoint in fan mode", async () => {
      const { simulator, client } = await unitWith({});

      simulator.setState({ mode: "fan", fanSpeed: "level5" });

      expect(await client.getState()).toMatchObject({
        mode: "fan",
        targetTemperatureInC: null,
        fanSpeed: "level5",
      });
    });

    it("is changed by the client and by setState alike", async () => {
      const { simulator, client } = await unitWith({});

      await client.setState({ power: true, targetTemperatureInC: 20 });
      simulator.setState({ swingMode: "both" });
      await client.setSpecialMode("powerful", true);

      expect(await client.getState()).toMatchObject({
        power: true,
        targetTemperatureInC: 20,
        swingMode: "both",
        specialModes: ["powerful"],
      });
    });

    it("rejects the start for a field the unit has nothing to hold", async () => {
      await expect(
        start({ state: { horizontalPosition: "position2" } }),
      ).rejects.toThrow("The simulated unit");
    });
  });

  describe("sensors", () => {
    it("are what getSensors reads, a temperature below zero included", async () => {
      const sensors = {
        indoorTemperatureInC: 19,
        outdoorTemperatureInC: -3.5,
        indoorHumidityInPercent: 40,
      };

      const { client } = await unitWith({ sensors });

      expect(await client.getSensors()).toEqual(sensors);
    });

    it("change with setSensors, null for a reading the unit lacks", async () => {
      const { simulator, client } = await unitWith({});

      simulator.setSensors({
        indoorTemperatureInC: 31,
        indoorHumidityInPercent: null,
      });

      expect(await client.getSensors()).toEqual({
        indoorTemperatureInC: 31,
        outdoorTemperatureInC: 30,
        indoorHumidityInPercent: null,
      });
    });
  });

  describe("unit", () => {
    it("offers dehumidify, cool and fan when it only cools", async () => {
      const { client } = await unitWith({ unit: { coolingOnly: true } });

      expect((await client.getCapabilities()).modes).toEqual([
        "dehumidify",
        "cool",
        "fan",
      ]);
    });

    it("takes no fan speed without a fan to set", async () => {
      const { client } = await unitWith({ unit: { fan: false } });

      expect((await client.getCapabilities()).fanSpeeds).toEqual([]);
    });

    it.each([
      ["none", []],
      ["vertical", ["off", "vertical"]],
      ["both", ["off", "vertical", "horizontal", "both"]],
    ] as const)("swings on %s", async (swing, swingModes) => {
      const { client } = await unitWith({ unit: { swing } });

      expect((await client.getCapabilities()).swingModes).toEqual(swingModes);
    });

    it("takes the special modes it is given", async () => {
      const { client } = await unitWith({
        unit: { specialModes: ["streamer"] },
      });

      expect((await client.getCapabilities()).specialModes).toMatchObject({
        cool: ["streamer"],
        fan: ["streamer"],
      });
    });

    it("takes the cool and heat setpoints it is given", async () => {
      const { client } = await unitWith({
        unit: {
          coolTemperaturesInC: { min: 16, max: 30 },
          heatTemperaturesInC: { min: 14, max: 28 },
        },
      });

      expect(
        (await client.getCapabilities()).targetTemperaturesInC,
      ).toMatchObject({
        cool: { min: 16, max: 30 },
        heat: { min: 14, max: 28 },
      });
    });
  });
});

describe("a classic simulator", () => {
  it("takes the fan levels it is given", async () => {
    const simulator = started(
      await startClassicSimulator({ unit: { fanLevels: 3 } }),
    );

    expect(
      (await clientFor(simulator, "classic").getCapabilities()).fanSpeeds,
    ).toEqual(["auto", "silent", "level1", "level3", "level5"]);
  });

  it("holds a field of modelInfo in place of what unit sets", async () => {
    const simulator = started(
      await startClassicSimulator({
        unit: { coolingOnly: true },
        modelInfo: { type: "N" },
      }),
    );

    expect(simulator.modelInfo.type).toBe("N");
  });

  it("holds the state in place of a field of controlInfo", async () => {
    const simulator = started(
      await startClassicSimulator({
        controlInfo: { stemp: "20.0", f_rate: "B" },
        state: { targetTemperatureInC: 27 },
      }),
    );

    expect(simulator.controlInfo).toMatchObject({
      stemp: "27.0",
      dt3: "27.0",
      f_rate: "B",
    });
  });

  it("sets both louvers, and f_dir with them, on a unit that reports them", async () => {
    const simulator = started(
      await startClassicSimulator({
        controlInfo: { f_dir_ud: "0", f_dir_lr: "0", ndfd3: "00", ndfd4: "S0" },
      }),
    );

    simulator.setState({
      swingMode: "horizontal",
      verticalPosition: "position3",
    });
    const cool = { ...simulator.controlInfo };
    simulator.setState({ mode: "heat" });

    expect(cool).toMatchObject({
      f_dir_ud: "3",
      f_dir_lr: "S",
      f_dir: "2",
      ndfd3: "3S",
    });
    expect(simulator.controlInfo).toMatchObject({
      f_dir_ud: "S",
      f_dir_lr: "0",
      f_dir: "1",
    });
  });

  it("is a unit with 3D airflow when given its fields", async () => {
    const simulator = started(
      await startClassicSimulator({
        modelInfo: {
          en_fdir2: "1",
          s_fdir_ud: "81",
          s_fdir_ud_step: "5",
          s_fdir_lr: "1",
        },
        controlInfo: { f_dir_ud: "0", f_dir_lr: "0" },
      }),
    );
    const client = clientFor(simulator, "classic");

    simulator.setState({ verticalPosition: "position3" });

    expect(await client.getCapabilities()).toMatchObject({
      verticalPositions: [
        "swing",
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
      ],
      horizontalPositions: ["stop", "swing"],
    });
    expect(await client.getState()).toMatchObject({
      verticalPosition: "position3",
      horizontalPosition: "stop",
    });
    await client.setState({ horizontalPosition: "swing" });
    expect(simulator.controlInfo).toMatchObject({
      f_dir_ud: "3",
      f_dir_lr: "S",
      f_dir: "2",
    });
  });

  it("holds a humidity setting and a percentage", async () => {
    const simulator = started(await startClassicSimulator());

    simulator.setState({ targetHumidity: "autoHigh" });
    const named = simulator.controlInfo.shum;
    simulator.setState({ targetHumidity: { percent: 45 } });

    expect(named).toBe("AUTO_H");
    expect(simulator.controlInfo).toMatchObject({ shum: "45", dh3: "45" });
  });

  it("throws for a louver position on a unit that reports no louvers", async () => {
    const simulator = started(await startClassicSimulator());

    expect(() => simulator.setState({ verticalPosition: "swing" })).toThrow(
      "The simulated unit reports no f_dir_ud to set",
    );
  });
});

describe("a dsiot simulator", () => {
  it("holds a fixed vertical position as the value at its rank", async () => {
    const simulator = started(await startDsiotSimulator());
    const client = clientFor(simulator, "dsiot");

    simulator.setState({
      verticalPosition: "position4",
      horizontalPosition: "swing",
    });

    expect(await client.getState()).toMatchObject({
      verticalPosition: "position4",
      horizontalPosition: "swing",
      swingMode: "horizontal",
    });
  });

  it("holds a leaf in place of what unit sets", async () => {
    const modelType = "/dsiot/edge/adr_0100.dgc_status.e_1002.e_A001.p_07";
    const simulator = started(
      await startDsiotSimulator({
        unit: { coolingOnly: true },
        leaves: { [modelType]: { pv: "00", pt: 3 } },
      }),
    );

    expect(simulator.leaves[modelType]?.pv).toBe("00");
  });

  it("holds a humidity setting on a unit with the mode's humidity leaf", async () => {
    const flag = "/dsiot/edge/adr_0100.dgc_status.e_1002.e_3001.p_0C";
    const simulator = started(
      await startDsiotSimulator({ leaves: { [flag]: { pv: "00", pt: 2 } } }),
    );
    const client = clientFor(simulator, "dsiot");

    simulator.setState({ targetHumidity: "continuous" });

    expect((await client.getState()).targetHumidity).toBe("continuous");
  });

  it.each([
    ["a humidity setting without the mode's leaf", { targetHumidity: "auto" }],
    ["a humidity percentage", { targetHumidity: { percent: 50 } }],
    ["a setpoint in fan mode", { mode: "fan", targetTemperatureInC: 24 }],
    ["a sixth fixed position", { verticalPosition: "position5", mode: "cool" }],
  ] as const)("throws for %s", async (_fault, state) => {
    const simulator = started(
      await startDsiotSimulator({
        leaves: {
          "/dsiot/edge/adr_0100.dgc_status.e_1002.e_3001.p_05": {
            pv: "000000",
            pt: 2,
            md: { pt: "b", mx: "1F800000" },
          },
        },
      }),
    );

    expect(() => simulator.setState(state)).toThrow("simulat");
  });

  it("throws for a louver on a unit that swings on no axis", async () => {
    const simulator = started(
      await startDsiotSimulator({ unit: { swing: "none" } }),
    );

    expect(() => simulator.setState({ swingMode: "vertical" })).toThrow(
      "The simulated unit reports no leaf",
    );
    expect(() => simulator.setState({ swingMode: "off" })).not.toThrow();
  });
});
