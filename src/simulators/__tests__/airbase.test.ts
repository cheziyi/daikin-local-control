import { afterEach, describe, expect, it } from "vitest";
import {
  type AirbaseDaikinClient,
  isAirbaseAdapter,
} from "../../clients/airbase.js";
import { createDaikinClient } from "../../factory.js";
import { DaikinTransport } from "../../transport.js";
import {
  type AirbaseDaikinSimulator,
  type StartAirbaseSimulatorOptions,
  startAirbaseSimulator,
} from "../airbase.js";
import { startClassicSimulator } from "../classic.js";
import type { DaikinSimulator } from "../simulator.js";

const simulators: DaikinSimulator[] = [];
const clients: AirbaseDaikinClient[] = [];
const transports: DaikinTransport[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
  await Promise.all(transports.splice(0).map((each) => each.dispose()));
  await Promise.all(simulators.splice(0).map((simulator) => simulator.stop()));
});

function started<SimulatorT extends DaikinSimulator>(
  simulator: SimulatorT,
): SimulatorT {
  simulators.push(simulator);
  return simulator;
}

async function simulatorWith(
  options?: StartAirbaseSimulatorOptions,
): Promise<AirbaseDaikinSimulator> {
  return started(await startAirbaseSimulator(options));
}

/** Sends one request, and resolves with the reply's status and its body
 * split into fields. */
async function send(
  simulator: DaikinSimulator,
  pathAndQuery: string,
  method = "GET",
): Promise<{ status: number; body: string; fields: Record<string, string> }> {
  const response = await fetch(`http://${simulator.host}${pathAndQuery}`, {
    method,
  });
  const body = await response.text();
  return {
    status: response.status,
    body,
    fields: Object.fromEntries(
      body
        .split(",")
        .filter((pair) => pair.includes("="))
        .map((pair) => {
          const index = pair.indexOf("=");
          return [pair.slice(0, index), pair.slice(index + 1)];
        }),
    ),
  };
}

function clientFor(simulator: AirbaseDaikinSimulator): AirbaseDaikinClient {
  const client = createDaikinClient(
    { host: simulator.host, protocol: "airbase" },
    { terminalUuid: "0123456789abcdef0123456789abcdef" },
  ) as AirbaseDaikinClient;
  clients.push(client);
  return client;
}

function transportTo(simulator: DaikinSimulator): DaikinTransport {
  const transport = new DaikinTransport({ host: simulator.host });
  transports.push(transport);
  return transport;
}

// Every field a write needs, for a unit in cool at 24 °C.
const CONTROL =
  "pow=1&mode=2&stemp=24.0&shum=--&f_rate=3&f_auto=0&f_airside=0&f_dir=0";

describe("startAirbaseSimulator", () => {
  describe("reads", () => {
    it("answers ret=OK first, then the endpoint's fields, below /skyfi", async () => {
      const simulator = await simulatorWith();

      expect((await send(simulator, "/skyfi/common/basic_info")).body).toBe(
        "ret=OK,type=aircon,reg=au,ver=1_1_8,name=Simulator,mac=02DA1C000002,lpw_flag=0",
      );
      expect((await send(simulator, "/skyfi/aircon/get_model_info")).body).toBe(
        "ret=OK,model=NOTSUPPORT,en_auto=1,en_dry=1,en_frate=1,en_frate_auto=1,frate_steps=3,en_fdir=1",
      );
      expect(
        (await send(simulator, "/skyfi/aircon/get_sensor_info")).body,
      ).toBe("ret=OK,htemp=26.0,otemp=30.0");
    });

    it("answers a field given in the options, or changed since, in place of its default", async () => {
      const simulator = await simulatorWith({
        modelInfo: { frate_steps: "2" },
        controlInfo: { shum: "0" },
      });
      simulator.sensorInfo.otemp = "-";

      expect(
        (await send(simulator, "/skyfi/aircon/get_model_info")).fields,
      ).toMatchObject({ frate_steps: "2" });
      expect(
        (await send(simulator, "/skyfi/aircon/get_control_info")).fields,
      ).toMatchObject({ shum: "0" });
      expect(
        (await send(simulator, "/skyfi/aircon/get_sensor_info")).fields.otemp,
      ).toBe("-");
    });

    it("answers HTTP 404 to a path outside /skyfi", async () => {
      const simulator = await simulatorWith();

      for (const path of [
        "/common/basic_info",
        "/aircon/get_control_info",
        "/",
      ]) {
        expect((await send(simulator, path)).status).toBe(404);
      }
    });

    it("answers HTTP 501 to an endpoint it does not have, and to a method other than GET", async () => {
      const simulator = await simulatorWith();

      expect((await send(simulator, "/skyfi/common/get_holiday")).status).toBe(
        501,
      );
      expect(
        (await send(simulator, "/skyfi/common/basic_info", "POST")).status,
      ).toBe(501);
    });

    it("answers a request without a terminal uuid or a local password", async () => {
      const simulator = await simulatorWith();

      expect(
        (await send(simulator, "/skyfi/aircon/get_control_info")).fields.ret,
      ).toBe("OK");
    });
  });

  describe("set_control_info", () => {
    const path = "/skyfi/aircon/set_control_info";

    it("holds the control fields it is sent", async () => {
      const simulator = await simulatorWith();

      expect((await send(simulator, `${path}?${CONTROL}`)).body).toBe("ret=OK");

      expect(simulator.controlInfo).toMatchObject({
        pow: "1",
        mode: "2",
        stemp: "24.0",
        f_rate: "3",
        f_auto: "0",
        f_airside: "0",
        f_dir: "0",
      });
    });

    it("holds what it is sent for cool's and heat's memory", async () => {
      const simulator = await simulatorWith();

      await send(simulator, `${path}?${CONTROL}&dt1=20.0&dfr1=5&auto1=1`);

      expect(simulator.controlInfo).toMatchObject({
        dt1: "20.0",
        dfr1: "5",
        auto1: "1",
      });
    });

    it("keeps the memory of the mode it runs on equal to what it holds", async () => {
      const simulator = await simulatorWith();

      await send(
        simulator,
        `${path}?${CONTROL.replace("stemp=24.0", "stemp=22.0")}`,
      );

      expect(simulator.controlInfo).toMatchObject({
        bk_auto: "2",
        dt2: "22.0",
        dfr2: "3",
        dt1: "25.0",
      });
    });

    it("answers PARAM NG and changes nothing without one of its eight fields", async () => {
      const simulator = await simulatorWith();

      for (const field of CONTROL.split("&")) {
        const query = CONTROL.split("&")
          .filter((each) => each !== field)
          .join("&");
        expect((await send(simulator, `${path}?${query}`)).body).toBe(
          "ret=PARAM NG",
        );
      }
      expect(simulator.controlInfo.pow).toBe("0");
    });

    it("drops a parameter that is not a control field, and one the unit does not report", async () => {
      const simulator = await simulatorWith();

      await send(simulator, `${path}?${CONTROL}&lpw=&dt0=24.0&ret=NG`);

      expect(simulator.controlInfo).not.toHaveProperty("lpw");
      expect(simulator.controlInfo).not.toHaveProperty("dt0");
      expect(simulator.controlInfo).not.toHaveProperty("shum");
      expect(simulator.controlInfo).not.toHaveProperty("ret");
    });
  });

  describe("zones", () => {
    it("answers the zones of a unit that has them, each open", async () => {
      const simulator = await simulatorWith({
        unit: { zones: ["Living Room", "Bedrooms"] },
      });

      expect(
        (await send(simulator, "/skyfi/aircon/get_zone_setting")).body,
      ).toBe("ret=OK,zone_name=Living%20Room%3BBedrooms,zone_onoff=1%3B1");
      expect(simulator.modelInfo.en_zone).toBe("2");
    });

    it("holds the zones set_zone_setting is sent", async () => {
      const simulator = await simulatorWith({ unit: { zones: ["A", "B"] } });

      expect(
        (
          await send(
            simulator,
            "/skyfi/aircon/set_zone_setting?zone_name=A%3BB&zone_onoff=0%3B1",
          )
        ).body,
      ).toBe("ret=OK");

      expect(simulator.zoneSetting).toEqual({
        zone_name: "A%3BB",
        zone_onoff: "0%3B1",
      });
    });

    it("answers PARAM NG without zone_name or zone_onoff", async () => {
      const simulator = await simulatorWith({ unit: { zones: ["A", "B"] } });

      expect(
        (await send(simulator, "/skyfi/aircon/set_zone_setting?zone_onoff=0"))
          .body,
      ).toBe("ret=PARAM NG");
    });

    it("answers HTTP 501 to both endpoints on a unit without zones", async () => {
      const simulator = await simulatorWith();

      expect(
        (await send(simulator, "/skyfi/aircon/get_zone_setting")).status,
      ).toBe(501);
      expect(
        (
          await send(
            simulator,
            "/skyfi/aircon/set_zone_setting?zone_name=A&zone_onoff=1",
          )
        ).status,
      ).toBe(501);
    });

    it("opens and closes a zone with setZone, and throws for one it lacks", async () => {
      const simulator = await simulatorWith({ unit: { zones: ["A", "B"] } });

      simulator.setZone(1, false);

      expect(simulator.zoneSetting.zone_onoff).toBe("1%3B0");
      expect(() => simulator.setZone(2, true)).toThrow(
        "The simulated unit has no zone 2",
      );
    });
  });

  describe("setState", () => {
    it("throws for a field an Airbase unit has nothing to hold", async () => {
      const simulator = await simulatorWith();

      expect(() => simulator.setState({ targetHumidity: "auto" })).toThrow(
        "The simulated unit has no targetHumidity to set",
      );
      expect(() => simulator.setState({ swingMode: "vertical" })).toThrow(
        "The simulated unit has no swingMode to set",
      );
      expect(() =>
        simulator.setState({ verticalPosition: "naturalWind" }),
      ).toThrow("The simulated unit takes no verticalPosition naturalWind");
      expect(() => simulator.setState({ specialModes: ["powerful"] })).toThrow(
        "The simulated unit has no specialModes to set",
      );
      expect(() => simulator.setState({ specialModes: [] })).not.toThrow();
    });

    it("rejects the start for such a field", async () => {
      await expect(
        startAirbaseSimulator({ state: { horizontalPosition: "swing" } }),
      ).rejects.toThrow("The simulated unit has no horizontalPosition to set");
    });
  });
});

describe("AirbaseDaikinClient against the simulator", () => {
  it("reads the adapter's name, MAC address and firmware version", async () => {
    const simulator = await simulatorWith({
      deviceInfo: { name: "Home AC", macAddress: "A4:08:EA:CC:91:D4" },
    });

    expect(await clientFor(simulator).getDeviceInfo()).toEqual({
      name: "Home AC",
      macAddress: "A4:08:EA:CC:91:D4",
      firmwareVersion: "1.1.8",
    });
  });

  it("reads the capabilities of a unit without zones", async () => {
    const simulator = await simulatorWith();

    expect(await clientFor(simulator).getCapabilities()).toMatchObject({
      modes: ["auto", "dehumidify", "cool", "heat", "fan"],
      fanSpeeds: ["auto", "level1", "level3", "level5"],
      swingModes: [],
      verticalPositions: [
        "position1",
        "position2",
        "position3",
        "position4",
        "position5",
        "swing",
      ],
      targetTemperaturesInC: {
        cool: { min: 18, max: 32, step: 1 },
        heat: { min: 10, max: 30, step: 1 },
      },
      model: "NOTSUPPORT",
    });
  });

  it("reads the capabilities of the unit it is given", async () => {
    const simulator = await simulatorWith({
      unit: {
        zones: ["A", "B"],
        auto: false,
        dehumidify: false,
        fanLevels: 2,
        coolTemperaturesInC: { min: 16, max: 30 },
        heatTemperaturesInC: { min: 14, max: 28 },
      },
    });

    expect(await clientFor(simulator).getCapabilities()).toMatchObject({
      modes: ["cool", "heat", "fan"],
      fanSpeeds: ["level1", "level5"],
      swingModes: [],
      targetTemperaturesInC: {
        auto: null,
        cool: { min: 16, max: 30, step: 1 },
        heat: { min: 14, max: 28, step: 1 },
      },
    });
  });

  it("takes no fan speed and no direction from a unit that has neither", async () => {
    const simulator = await simulatorWith({
      unit: { fan: false, swing: false },
    });

    expect(await clientFor(simulator).getCapabilities()).toMatchObject({
      fanSpeeds: [],
      swingModes: [],
    });
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
      verticalPosition: "position1",
      horizontalPosition: null,
      specialModes: [],
    });
  });

  it("reads back the state it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({
      power: true,
      mode: "heat",
      targetTemperatureInC: 21,
      fanSpeed: "level3",
      verticalPosition: "swing",
    });

    expect(await client.getState()).toMatchObject({
      power: true,
      mode: "heat",
      targetTemperatureInC: 21,
      fanSpeed: "level3",
      swingMode: "vertical",
      verticalPosition: "swing",
    });
  });

  it("returns to the values cool held when it sets cool again", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({ targetTemperatureInC: 22, fanSpeed: "level5" });
    await client.setState({ mode: "heat", targetTemperatureInC: 20 });
    await client.setState({ fanSpeed: "level1" });
    await client.setState({ mode: "cool" });

    expect(await client.getState()).toMatchObject({
      mode: "cool",
      targetTemperatureInC: 22,
      fanSpeed: "level5",
    });
  });

  it("runs fan and auto on the mode the unit last cooled or heated in", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({ mode: "heat", targetTemperatureInC: 20 });
    await client.setState({ mode: "auto" });

    expect(await client.getState()).toMatchObject({
      mode: "auto",
      targetTemperatureInC: 20,
    });
    expect(simulator.controlInfo.bk_auto).toBe("1");
  });

  it("reads no setpoint once it set dehumidify, and cool's again after it", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({ mode: "dehumidify" });
    expect((await client.getState()).targetTemperatureInC).toBeNull();

    await client.setState({ mode: "cool" });
    expect((await client.getState()).targetTemperatureInC).toBe(24);
  });

  it("reads a change made on the simulator, as one made on the wall controller", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    simulator.setState({ power: true, mode: "heat", fanSpeed: "level5" });

    expect(await client.getState()).toMatchObject({
      power: true,
      mode: "heat",
      targetTemperatureInC: 25,
      fanSpeed: "level5",
    });
  });

  it("reads the sensors, null for a reading the unit lacks", async () => {
    const simulator = await simulatorWith({
      sensors: { indoorTemperatureInC: 23.5, outdoorTemperatureInC: null },
    });

    expect(await clientFor(simulator).getSensors()).toEqual({
      indoorTemperatureInC: 23.5,
      outdoorTemperatureInC: null,
      indoorHumidityInPercent: null,
    });
  });

  it("reads and sets the zones of a unit that has them", async () => {
    const simulator = await simulatorWith({
      unit: { zones: ["Living Room", "Bedrooms", "Study"] },
    });
    const client = clientFor(simulator);

    await client.setZone(1, false);
    simulator.setZone(2, false);

    expect(await client.getZones()).toEqual([
      { name: "Living Room", enabled: true },
      { name: "Bedrooms", enabled: false },
      { name: "Study", enabled: false },
    ]);
  });

  it("reads no zones from a unit without any, and asks it for none", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    expect(await client.getZones()).toEqual([]);
    await expect(client.setZone(0, true)).rejects.toThrow(
      "The unit has no zone 0: it has 0",
    );
    expect(simulator.requests.map(({ path }) => path)).toEqual([
      "/skyfi/common/basic_info",
      "/skyfi/aircon/get_model_info",
    ]);
  });

  it("reads back fan auto and airside on a unit with zones", async () => {
    const simulator = await simulatorWith({
      unit: { zones: ["A", "B"], airside: true },
      state: { fanSpeed: "level3" },
    });
    const client = clientFor(simulator);

    expect(await client.getFanAuto()).toBe(false);
    await client.setFanAuto(true);
    expect(await client.getFanAuto()).toBe(true);
    expect((await client.getState()).fanSpeed).toBe("level3");

    await client.setAirside(true);
    expect(await client.getAirside()).toBe(true);
    expect(await client.getFanAuto()).toBe(false);
    expect((await client.getState()).fanSpeed).toBe("level1");

    await client.setState({ fanSpeed: "level5" });
    expect(await client.getAirside()).toBe(false);
  });

  it("reads null for fan auto and airside on a unit without zones", async () => {
    const client = clientFor(await simulatorWith());

    expect(await client.getFanAuto()).toBeNull();
    expect(await client.getAirside()).toBeNull();
  });

  it("is rejected with status 501 for an endpoint the simulator does not have", async () => {
    const client = clientFor(await simulatorWith());

    await expect(client.command("/common/get_holiday")).rejects.toMatchObject({
      name: "DaikinError",
      httpStatusCode: 501,
    });
  });
});

describe("isAirbaseAdapter against the simulators", () => {
  it("passes an Airbase simulator", async () => {
    const simulator = await simulatorWith();

    expect(await isAirbaseAdapter(transportTo(simulator))).toBe(true);
    expect(simulator.requests.map(({ path }) => path)).toEqual([
      "/common/basic_info",
      "/skyfi/common/basic_info",
    ]);
  });

  it("passes no classic simulator, one that requires registration included", async () => {
    const classic = started(await startClassicSimulator());
    const registering = started(
      await startClassicSimulator({ key: "0123456789012" }),
    );

    expect(await isAirbaseAdapter(transportTo(classic))).toBe(false);
    expect(await isAirbaseAdapter(transportTo(registering))).toBe(false);
    expect(classic.requests).toHaveLength(1);
    expect(registering.requests).toHaveLength(1);
  });
});
