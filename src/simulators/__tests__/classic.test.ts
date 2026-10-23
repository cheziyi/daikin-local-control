import { afterEach, describe, expect, it } from "vitest";
import type { ClassicDaikinClient } from "../../clients/classic.js";
import { DaikinError } from "../../error.js";
import {
  type CreateDaikinClientOptions,
  createDaikinClient,
} from "../../factory.js";
import {
  type ClassicDaikinSimulator,
  type StartClassicSimulatorOptions,
  startClassicSimulator,
} from "../classic.js";

const TERMINAL_UUID = "0123456789abcdef0123456789abcdef";
const OTHER_TERMINAL_UUID = "fedcba9876543210fedcba9876543210";

const simulators: ClassicDaikinSimulator[] = [];
const clients: ClassicDaikinClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
  await Promise.all(simulators.splice(0).map((simulator) => simulator.stop()));
});

async function simulatorWith(
  options?: StartClassicSimulatorOptions,
): Promise<ClassicDaikinSimulator> {
  const simulator = await startClassicSimulator(options);
  simulators.push(simulator);
  return simulator;
}

/** Sends one GET as a terminal would, and resolves with the reply's status
 * and its body split into fields. */
async function get(
  simulator: ClassicDaikinSimulator,
  pathAndQuery: string,
  terminalUuid = TERMINAL_UUID,
): Promise<{ status: number; body: string; fields: Record<string, string> }> {
  const response = await fetch(`http://${simulator.host}${pathAndQuery}`, {
    headers: { "X-Daikin-uuid": terminalUuid },
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

function clientFor(
  simulator: ClassicDaikinSimulator,
  options: Partial<CreateDaikinClientOptions> = {},
): ClassicDaikinClient {
  const client = createDaikinClient(
    { host: simulator.host, protocol: "classic" },
    { terminalUuid: TERMINAL_UUID, retry: { delaysInMs: [] }, ...options },
  ) as ClassicDaikinClient;
  clients.push(client);
  return client;
}

describe("startClassicSimulator", () => {
  describe("reads", () => {
    it("answers ret=OK first, then the endpoint's fields", async () => {
      const simulator = await simulatorWith();

      const { status, body } = await get(simulator, "/aircon/get_sensor_info");

      expect(status).toBe(200);
      expect(body).toBe("ret=OK,htemp=26.0,hhum=55,otemp=30.0");
    });

    it("answers a field given in the options in place of its default", async () => {
      const simulator = await simulatorWith({
        modelInfo: { type: "C" },
        sensorInfo: { htemp: "19.5" },
      });

      expect(
        (await get(simulator, "/aircon/get_model_info")).fields,
      ).toMatchObject({ type: "C", en_fdir: "1" });
      expect(
        (await get(simulator, "/aircon/get_sensor_info")).fields.htemp,
      ).toBe("19.5");
    });

    it("answers a field the caller changed after it started", async () => {
      const simulator = await simulatorWith();

      simulator.sensorInfo.htemp = "31.0";
      delete simulator.sensorInfo.hhum;

      expect((await get(simulator, "/aircon/get_sensor_info")).body).toBe(
        "ret=OK,htemp=31.0,otemp=30.0",
      );
    });

    it("answers HTTP 501 to an endpoint it does not have", async () => {
      const simulator = await simulatorWith();

      const { status, body } = await get(simulator, "/aircon/get_timer");

      expect(status).toBe(501);
      expect(body).toBe("The simulator does not answer GET /aircon/get_timer");
    });

    it("answers HTTP 501 to a method other than GET", async () => {
      const simulator = await simulatorWith();

      const response = await fetch(
        `http://${simulator.host}/common/basic_info`,
        { method: "POST" },
      );

      expect(response.status).toBe(501);
    });
  });

  describe("set_control_info", () => {
    const CONTROL = "pow=1&mode=3&stemp=22.0&shum=0&f_rate=5&f_dir=1";

    it("holds the control fields it is sent", async () => {
      const simulator = await simulatorWith();

      const { body } = await get(
        simulator,
        `/aircon/set_control_info?${CONTROL}`,
      );

      expect(body).toBe("ret=OK");
      expect(simulator.controlInfo).toMatchObject({
        pow: "1",
        mode: "3",
        stemp: "22.0",
        shum: "0",
        f_rate: "5",
        f_dir: "1",
      });
    });

    it("remembers what the unit holds as the memory of its mode", async () => {
      const simulator = await simulatorWith();

      await get(simulator, `/aircon/set_control_info?${CONTROL}`);

      expect(simulator.controlInfo).toMatchObject({
        dt3: "22.0",
        dh3: "0",
        dfr3: "5",
        dfd3: "1",
        dt4: "25.0",
        dfr4: "A",
        dfd4: "0",
      });
    });

    it("holds the memory of another mode when it is sent one", async () => {
      const simulator = await simulatorWith();

      await get(simulator, `/aircon/set_control_info?${CONTROL}&dfd4=3`);

      expect(simulator.controlInfo.dfd4).toBe("3");
    });

    it("keeps no memory for a mode that reports none", async () => {
      const simulator = await simulatorWith();

      await get(
        simulator,
        "/aircon/set_control_info?pow=1&mode=6&stemp=--&shum=--&f_rate=A",
      );

      expect(simulator.controlInfo).toMatchObject({ mode: "6", dfr6: "A" });
      expect(simulator.controlInfo).not.toHaveProperty("dt6");
    });

    it("answers PARAM NG and changes nothing without pow, mode, stemp, shum or f_rate", async () => {
      const simulator = await simulatorWith();

      const { status, body } = await get(
        simulator,
        "/aircon/set_control_info?pow=1&mode=4&stemp=22.0&shum=0",
      );

      expect(status).toBe(200);
      expect(body).toBe("ret=PARAM NG");
      expect(simulator.controlInfo).toMatchObject({ pow: "0", mode: "3" });
    });

    it("takes a request without shum on a unit that reports none", async () => {
      const simulator = await simulatorWith();
      delete simulator.controlInfo.shum;

      const { body } = await get(
        simulator,
        "/aircon/set_control_info?pow=1&mode=3&stemp=22.0&f_rate=A",
      );

      expect(body).toBe("ret=OK");
    });

    it("drops a parameter that is not a control field", async () => {
      const simulator = await simulatorWith();

      await get(
        simulator,
        `/aircon/set_control_info?${CONTROL}&adv=2&f_dir_ud=S`,
      );

      expect(simulator.controlInfo.adv).toBe("");
      expect(simulator.controlInfo).not.toHaveProperty("f_dir_ud");
    });

    it("remembers both louvers in ndfd on a unit that reports them", async () => {
      const simulator = await simulatorWith({
        controlInfo: { f_dir_ud: "0", f_dir_lr: "0", ndfd3: "00", ndfd4: "00" },
      });

      await get(
        simulator,
        `/aircon/set_control_info?${CONTROL}&f_dir_ud=S&f_dir_lr=2`,
      );

      expect(simulator.controlInfo).toMatchObject({ ndfd3: "S2", ndfd4: "00" });
    });
  });

  describe("set_special_mode", () => {
    const adv = async (simulator: ClassicDaikinSimulator, query: string) => {
      await get(simulator, `/aircon/set_special_mode?${query}`);
      return simulator.controlInfo.adv;
    };

    it("reports powerful as 2, econo as 12 and heat plus as 4 in adv", async () => {
      const simulator = await simulatorWith();

      expect(await adv(simulator, "set_spmode=1&spmode_kind=1")).toBe("2");
      expect(await adv(simulator, "set_spmode=1&spmode_kind=2")).toBe("12");
      expect(await adv(simulator, "set_spmode=1&spmode_kind=4")).toBe("4");
    });

    it("keeps the streamer, 13, beside another special mode", async () => {
      const simulator = await simulatorWith();

      expect(await adv(simulator, "en_streamer=1")).toBe("13");
      expect(await adv(simulator, "set_spmode=1&spmode_kind=1")).toBe("2/13");
      expect(await adv(simulator, "set_spmode=0&spmode_kind=1")).toBe("13");
      expect(await adv(simulator, "en_streamer=0")).toBe("");
    });

    it("answers PARAM NG to a kind it does not know", async () => {
      const simulator = await simulatorWith();

      const { body } = await get(
        simulator,
        "/aircon/set_special_mode?set_spmode=1&spmode_kind=3",
      );

      expect(body).toBe("ret=PARAM NG");
    });
  });

  describe("settings", () => {
    it("holds a name percent-encoded, as basic_info answers it", async () => {
      const simulator = await simulatorWith();

      await get(simulator, "/common/set_name?name=Living%20Room");

      expect((await get(simulator, "/common/basic_info")).fields.name).toBe(
        "Living%20Room",
      );
    });

    it("answers PARAM NG to a write without its parameter", async () => {
      const simulator = await simulatorWith();

      expect((await get(simulator, "/common/set_led")).body).toBe(
        "ret=PARAM NG",
      );
      expect(simulator.basicInfo.led).toBe("1");
    });
  });

  describe("with a key", () => {
    it("reports en_secure=1 and answers HTTP 403 to a terminal that is not registered", async () => {
      const simulator = await simulatorWith({ key: "0123456789012" });

      expect(simulator.basicInfo.en_secure).toBe("1");
      expect((await get(simulator, "/common/basic_info")).status).toBe(403);
    });

    it("answers a terminal once register_terminal is sent the key", async () => {
      const simulator = await simulatorWith({ key: "0123456789012" });

      const registration = await get(
        simulator,
        "/common/register_terminal?key=0123456789012",
      );

      expect(registration.body).toBe("ret=OK");
      expect(simulator.registeredTerminalUuids).toEqual(
        new Set([TERMINAL_UUID]),
      );
      expect((await get(simulator, "/common/basic_info")).status).toBe(200);
      expect(
        (await get(simulator, "/common/basic_info", OTHER_TERMINAL_UUID))
          .status,
      ).toBe(403);
    });

    it("answers HTTP 403 to register_terminal with another key", async () => {
      const simulator = await simulatorWith({ key: "0123456789012" });

      const registration = await get(
        simulator,
        "/common/register_terminal?key=9999999999999",
      );

      expect(registration.status).toBe(403);
      expect(simulator.registeredTerminalUuids.size).toBe(0);
    });

    it.each([
      ["0", "this terminal", [OTHER_TERMINAL_UUID]],
      ["1", "every other terminal", [TERMINAL_UUID]],
      ["2", "every terminal", []],
    ])("unregisters, for type=%s, %s", async (type, _scope, remaining) => {
      const simulator = await simulatorWith({ key: "0123456789012" });
      simulator.registeredTerminalUuids.add(TERMINAL_UUID);
      simulator.registeredTerminalUuids.add(OTHER_TERMINAL_UUID);

      await get(simulator, `/common/unregister_terminal?type=${type}`);

      expect([...simulator.registeredTerminalUuids]).toEqual(remaining);
    });
  });

  describe("with a local password", () => {
    it("reports lpw_flag=1 and answers LPW NG without the lpw", async () => {
      const simulator = await simulatorWith({ localPassword: "1234" });

      const { status, body } = await get(simulator, "/common/basic_info");

      expect(simulator.basicInfo.lpw_flag).toBe("1");
      expect(status).toBe(200);
      expect(body).toBe("ret=LPW NG");
    });

    it("answers a request that carries the lpw", async () => {
      const simulator = await simulatorWith({ localPassword: "1234" });

      expect(
        (await get(simulator, "/common/basic_info?lpw=1234")).fields.ret,
      ).toBe("OK");
      expect((await get(simulator, "/common/basic_info?lpw=0000")).body).toBe(
        "ret=LPW NG",
      );
    });
  });

  describe("requests", () => {
    it("lists each request received, a refused one included", async () => {
      const simulator = await simulatorWith();

      await get(simulator, "/common/set_led?led=0");
      await get(simulator, "/aircon/get_timer");

      expect(simulator.requests).toMatchObject([
        {
          method: "GET",
          path: "/common/set_led",
          query: { led: "0" },
          headers: { "x-daikin-uuid": TERMINAL_UUID },
          body: "",
        },
        { method: "GET", path: "/aircon/get_timer", query: {} },
      ]);
    });
  });

  describe("stop", () => {
    it("refuses a connection once stopped, and resolves when called again", async () => {
      const simulator = await simulatorWith();

      await simulator.stop();
      await simulator.stop();

      await expect(get(simulator, "/common/basic_info")).rejects.toThrow();
    });
  });
});

describe("ClassicDaikinClient against the simulator", () => {
  it("reads the adapter's name, MAC address and firmware version", async () => {
    const simulator = await simulatorWith();

    expect(await clientFor(simulator).getDeviceInfo()).toEqual({
      name: "Simulator",
      macAddress: "02:DA:1C:00:00:01",
      firmwareVersion: "1.2.51",
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
      verticalPositions: [],
      horizontalPositions: [],
      targetTemperaturesInC: {
        auto: { min: 18, max: 30, step: 1 },
        cool: { min: 18, max: 32, step: 1 },
        heat: { min: 10, max: 30, step: 1 },
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
        heat: ["powerful", "econo", "streamer", "heatPlus"],
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
    const simulator = await simulatorWith({ modelInfo: { type: "C" } });

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
      targetHumidity: "off",
      fanSpeed: "auto",
      swingMode: "off",
      verticalPosition: null,
      horizontalPosition: null,
      specialModes: [],
    });
  });

  it("reads back the state it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({
      power: true,
      targetTemperatureInC: 22,
      fanSpeed: "level3",
      swingMode: "vertical",
    });

    expect(await client.getState()).toMatchObject({
      power: true,
      mode: "cool",
      targetTemperatureInC: 22,
      fanSpeed: "level3",
      swingMode: "vertical",
    });
  });

  it("returns to the values a mode held when it sets that mode again", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);
    await client.setState({
      targetTemperatureInC: 22,
      fanSpeed: "level3",
      swingMode: "vertical",
    });

    await client.setState({ mode: "heat" });
    const heat = await client.getState();
    await client.setState({ mode: "cool" });
    const cool = await client.getState();

    expect(heat).toMatchObject({
      mode: "heat",
      targetTemperatureInC: 25,
      fanSpeed: "auto",
      swingMode: "off",
    });
    expect(cool).toMatchObject({
      mode: "cool",
      targetTemperatureInC: 22,
      fanSpeed: "level3",
      swingMode: "vertical",
    });
  });

  it("reads no setpoint once it set fan mode", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setState({ mode: "fan" });

    expect(await client.getState()).toMatchObject({
      mode: "fan",
      targetTemperatureInC: null,
      targetHumidity: null,
    });
  });

  it("reads a change made on the simulator, as one made on the remote control", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    simulator.controlInfo.pow = "1";
    simulator.controlInfo.f_rate = "B";

    expect(await client.getState()).toMatchObject({
      power: true,
      fanSpeed: "silent",
    });
  });

  it("reads the sensors", async () => {
    const simulator = await simulatorWith();

    expect(await clientFor(simulator).getSensors()).toEqual({
      indoorTemperatureInC: 26,
      outdoorTemperatureInC: 30,
      indoorHumidityInPercent: 55,
    });
  });

  it("reads back the special modes it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setSpecialMode("powerful", true);
    await client.setSpecialMode("streamer", true);
    const powerful = (await client.getState()).specialModes;
    await client.setSpecialMode("econo", true);
    const econo = (await client.getState()).specialModes;
    await client.setSpecialMode("heatPlus", true);
    const heatPlus = (await client.getState()).specialModes;
    await client.setSpecialMode("heatPlus", false);

    expect(powerful).toEqual(["powerful", "streamer"]);
    expect(econo).toEqual(["econo", "streamer"]);
    expect(heatPlus).toEqual(["streamer", "heatPlus"]);
    expect((await client.getState()).specialModes).toEqual(["streamer"]);
  });

  it("reads back the settings it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setLed(false);
    await client.setHolidayMode(true);
    await client.setOutOfHomeAccess(true);
    await client.setMetadata({
      name: "Séjour, 1=2",
      icon: "3",
      group: { name: "Up stairs", enabled: true },
    });

    expect(await client.getLed()).toBe(false);
    expect(await client.getHolidayMode()).toBe(true);
    expect(await client.getOutOfHomeAccess()).toBe(true);
    expect(await client.getMetadata()).toEqual({
      name: "Séjour, 1=2",
      icon: "3",
      group: { name: "Up stairs", enabled: true },
    });
  });

  it("answers get_remote_method with the method of basic_info", async () => {
    const simulator = await simulatorWith({ basicInfo: { method: "polling" } });

    expect(
      await clientFor(simulator).command("/common/get_remote_method"),
    ).toEqual({
      ret: "OK",
      method: "polling",
      notice_ip_int: "3600",
      notice_sync_int: "60",
    });
  });

  it("sends the intervals back with the out-of-home access it sets", async () => {
    const simulator = await simulatorWith();

    await clientFor(simulator).setOutOfHomeAccess(false);

    expect(simulator.requests.at(-1)).toMatchObject({
      path: "/common/set_remote_method",
      query: {
        method: "home only",
        notice_ip_int: "3600",
        notice_sync_int: "60",
      },
    });
    expect(simulator.basicInfo.method).toBe("home only");
  });

  it("sets demand control, the energy price and target, and reboots", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    await client.setDemandControl({
      enabled: true,
      maxPowerInPercent: 70,
      mode: "manual",
    });
    await client.setEnergyPrice(0.3);
    await client.setEnergyTarget(120);
    await client.reboot();

    expect(simulator.requests.map(({ path }) => path)).toEqual([
      "/aircon/set_demand_control",
      "/aircon/set_price",
      "/aircon/set_target",
      "/common/reboot",
    ]);
  });

  it("reads back the demand control, energy price and target it set", async () => {
    const simulator = await simulatorWith();
    const client = clientFor(simulator);

    expect(await client.getDemandControl()).toEqual({
      enabled: false,
      maxPowerInPercent: 100,
      mode: "manual",
    });

    await client.setDemandControl({
      enabled: true,
      maxPowerInPercent: 85,
      mode: "auto",
    });
    await client.setEnergyPrice(1.05);
    await client.setEnergyTarget(120);

    expect(await client.getDemandControl()).toEqual({
      enabled: true,
      maxPowerInPercent: 85,
      mode: "auto",
    });
    expect(await client.getEnergyPrice()).toBe(1.05);
    expect(await client.getEnergyTarget()).toBe(120);
  });

  it("is rejected with status 403 until it registers its terminal", async () => {
    const simulator = await simulatorWith({ key: "0123456789012" });
    const client = clientFor(simulator);

    await expect(client.getState()).rejects.toMatchObject({
      httpStatusCode: 403,
    });
    await expect(client.registerTerminal("9999999999999")).rejects.toThrow(
      DaikinError,
    );

    await client.registerTerminal("0123456789012");
    expect((await client.getState()).mode).toBe("cool");

    await client.unregisterTerminal();
    await expect(client.getState()).rejects.toMatchObject({
      httpStatusCode: 403,
    });
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

  it("is rejected with status 501 for an endpoint the simulator does not have", async () => {
    const simulator = await simulatorWith();

    await expect(
      clientFor(simulator).command("/aircon/get_timer"),
    ).rejects.toMatchObject({ httpStatusCode: 501 });
  });
});
