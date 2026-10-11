import { describe, expect, it } from "vitest";
import { DaikinConnectionError, DaikinError } from "../../error.js";
import { ClassicDaikinClient } from "../classic.js";
import { failingFirst, MockDaikinTransport } from "./mocks/transport.js";

const BASIC_INFO = "/common/basic_info";
const GET_MODEL_INFO = "/aircon/get_model_info";
const GET_CONTROL_INFO = "/aircon/get_control_info";
const SET_CONTROL_INFO = "/aircon/set_control_info";

// A unit that takes `f_dir` alone, running in cool at 24 °C.
const UNIT = {
  [BASIC_INFO]: "ret=OK,type=aircon,reg=sg,adp_kind=4",
  [GET_MODEL_INFO]: "ret=OK,type=N,cpv=3,en_fdir=1,s_fdir=3",
  [GET_CONTROL_INFO]: "ret=OK,pow=1,mode=3,stemp=24.0,shum=0,f_rate=A,f_dir=1",
  [SET_CONTROL_INFO]: "ret=OK",
};

// Answers each path with its canned body.
function adapter(bodies: Record<string, string>): MockDaikinTransport {
  return new MockDaikinTransport(({ path }) => {
    const body = bodies[path];
    if (body === undefined) {
      throw new Error(`No body is stubbed for ${path}`);
    }
    return body;
  });
}

function classicClient(transport: MockDaikinTransport): ClassicDaikinClient {
  return new ClassicDaikinClient(transport.asTransport());
}

function pathsSentTo(transport: MockDaikinTransport): string[] {
  return transport.sent.map(({ path }) => path);
}

function queriesSentTo(
  transport: MockDaikinTransport,
  path: string,
): (Record<string, string> | undefined)[] {
  return transport.sent
    .filter((request) => request.path === path)
    .map(({ query }) => query);
}

describe("ClassicDaikinClient", () => {
  describe("getState", () => {
    it("reads get_control_info into a DaikinState", async () => {
      const transport = adapter(UNIT);

      expect(await classicClient(transport).getState()).toEqual({
        power: true,
        mode: "cool",
        targetTemperatureInC: 24,
        targetHumidity: "off",
        fanSpeed: "auto",
        swingMode: "vertical",
        verticalPosition: null,
        horizontalPosition: null,
      });
      expect(transport.sent).toStrictEqual([
        { method: "GET", path: GET_CONTROL_INFO },
      ]);
    });
  });

  describe("setState", () => {
    it("reads the capabilities and get_control_info, then writes set_control_info", async () => {
      const transport = adapter(UNIT);

      await classicClient(transport).setState({ targetTemperatureInC: 23 });

      expect(pathsSentTo(transport)).toEqual([
        BASIC_INFO,
        GET_MODEL_INFO,
        GET_CONTROL_INFO,
        SET_CONTROL_INFO,
      ]);
    });

    it("writes the control over the state it read", async () => {
      const transport = adapter({
        ...UNIT,
        [GET_CONTROL_INFO]:
          "ret=OK,pow=0,mode=4,adv=,stemp=22.0,shum=0,f_rate=3,f_dir=0,dt3=25.0,dt4=22.0,dh3=0,dh4=0,dfr3=5,dfr4=3,b_mode=4",
      });

      await classicClient(transport).setState({
        power: true,
        targetTemperatureInC: 23,
      });

      expect(queriesSentTo(transport, SET_CONTROL_INFO)).toEqual([
        {
          pow: "1",
          mode: "4",
          stemp: "23.0",
          dt4: "23.0",
          shum: "0",
          dh4: "0",
          f_rate: "3",
          f_dir: "0",
        },
      ]);
    });

    it("writes no airflow field to a unit whose model info offers none", async () => {
      const transport = adapter({
        ...UNIT,
        [GET_MODEL_INFO]: "ret=OK,type=N,cpv=3",
        [GET_CONTROL_INFO]: "ret=OK,pow=1,mode=3,f_dir=0,f_dir_ud=0",
      });

      await classicClient(transport).setState({ swingMode: "vertical" });

      const [query] = queriesSentTo(transport, SET_CONTROL_INFO);
      expect(query).not.toHaveProperty("f_dir");
      expect(query).not.toHaveProperty("f_dir_ud");
      expect(query).not.toHaveProperty("f_dir_lr");
    });

    it("writes the louvers of a unit whose model info says it is 3D", async () => {
      const transport = adapter({
        ...UNIT,
        [GET_MODEL_INFO]: "ret=OK,type=N,cpv=3,en_fdir=1,s_fdir=3,en_fdir2=1",
        [GET_CONTROL_INFO]:
          "ret=OK,pow=1,mode=3,stemp=24.0,shum=0,f_rate=A,f_dir=1,f_dir_ud=S,f_dir_lr=0",
      });
      const client = classicClient(transport);

      expect(await client.getState()).toMatchObject({
        verticalPosition: "swing",
        horizontalPosition: "stop",
      });

      await client.setState({ swingMode: "both" });

      expect(queriesSentTo(transport, SET_CONTROL_INFO)).toMatchObject([
        { f_dir: "3", f_dir_ud: "S", f_dir_lr: "S" },
      ]);
    });

    it("reads the capabilities once, however many controls it writes", async () => {
      const transport = adapter(UNIT);
      const client = classicClient(transport);

      await client.setState({ power: false });
      await client.setState({ power: true });
      await client.getCapabilities();

      expect(queriesSentTo(transport, BASIC_INFO)).toHaveLength(1);
      expect(queriesSentTo(transport, GET_MODEL_INFO)).toHaveLength(1);
      expect(queriesSentTo(transport, SET_CONTROL_INFO)).toHaveLength(2);
    });

    it("reads the capabilities again after a read of them failed", async () => {
      const timedOut = new DaikinError("timed out", 504);
      const transport = new MockDaikinTransport(
        failingFirst(
          1,
          timedOut,
          ({ path }) => UNIT[path as keyof typeof UNIT],
        ),
      );
      const client = classicClient(transport);

      await expect(client.setState({ power: false })).rejects.toBe(timedOut);
      await client.setState({ power: false });

      expect(pathsSentTo(transport)).toEqual([
        BASIC_INFO,
        BASIC_INFO,
        GET_MODEL_INFO,
        GET_CONTROL_INFO,
        SET_CONTROL_INFO,
      ]);
    });
  });

  describe("getCapabilities", () => {
    it("reads basic_info and get_model_info together", async () => {
      const transport = adapter({
        [BASIC_INFO]: "ret=OK,type=aircon,reg=sg,adp_kind=4",
        [GET_MODEL_INFO]:
          "ret=OK,type=C,cpv=3,dmnd=1,en_frate=1,cmlmt_l=18,cmlmt_h=32",
      });

      const capabilities = await classicClient(transport).getCapabilities();

      expect(pathsSentTo(transport)).toEqual([BASIC_INFO, GET_MODEL_INFO]);
      // `type=C` is the unit's, `adp_kind` the adapter's and `reg` gates the fan.
      expect(capabilities.modes).toEqual(["dehumidify", "cool", "fan"]);
      expect(capabilities.demandControl).toBe(true);
      expect(capabilities.fanSpeeds).toContain("auto");
      expect(capabilities.targetTemperatureInC.cool).toEqual({
        min: 18,
        max: 32,
        step: 1,
      });
    });
  });

  describe("getSensors", () => {
    it("reads get_sensor_info into DaikinSensors", async () => {
      const transport = adapter({
        "/aircon/get_sensor_info": "ret=OK,htemp=25.5,hhum=-,otemp=",
      });

      expect(await classicClient(transport).getSensors()).toEqual({
        indoorTemperatureInC: 25.5,
        indoorHumidityInPercent: null,
        outdoorTemperatureInC: null,
      });
    });
  });

  describe("extended controls", () => {
    it.each<
      [
        string,
        (client: ClassicDaikinClient) => Promise<void>,
        string,
        Record<string, string>,
      ]
    >([
      [
        "setLed",
        (client) => client.setLed(true),
        "/common/set_led",
        { led: "1" },
      ],
      [
        "setHolidayMode",
        (client) => client.setHolidayMode(true),
        "/common/set_holiday",
        { en_hol: "1" },
      ],
      [
        "setDemandControl",
        (client) =>
          client.setDemandControl({
            enabled: true,
            maxPowerInPercent: 70,
            mode: "manual",
          }),
        "/aircon/set_demand_control",
        { demand_type: "1", en_demand: "1", mode: "0", max_pow: "70" },
      ],
      [
        "setSpecialMode",
        (client) => client.setSpecialMode("econo", true),
        "/aircon/set_special_mode",
        { set_spmode: "1", spmode_kind: "2" },
      ],
      [
        "setEnergyPrice",
        (client) => client.setEnergyPrice(0.3),
        "/aircon/set_price",
        { price_int: "0", price_dec: "30" },
      ],
      [
        "setEnergyTarget",
        (client) => client.setEnergyTarget(120),
        "/aircon/set_target",
        { target: "120" },
      ],
      [
        "registerTerminal",
        (client) => client.registerTerminal("0123456789abcdef"),
        "/common/register_terminal",
        { key: "0123456789abcdef" },
      ],
      [
        "unregisterTerminal",
        (client) => client.unregisterTerminal("others"),
        "/common/unregister_terminal",
        { type: "1" },
      ],
    ])(
      "%s sends one GET to its endpoint",
      async (_method, call, path, query) => {
        const transport = adapter({ [path]: "ret=OK" });

        await call(classicClient(transport));

        expect(transport.sent).toEqual([{ method: "GET", path, query }]);
      },
    );

    it("unregisterTerminal unregisters this terminal's own uuid by default", async () => {
      const transport = adapter({ "/common/unregister_terminal": "ret=OK" });

      await classicClient(transport).unregisterTerminal();

      expect(transport.sent).toMatchObject([{ query: { type: "0" } }]);
    });

    it("setOutOfHomeAccess reads get_remote_method and sends its intervals back", async () => {
      const transport = adapter({
        "/common/get_remote_method":
          "ret=OK,method=polling,notice_ip_int=3600,notice_sync_int=60",
        "/common/set_remote_method": "ret=OK",
      });

      await classicClient(transport).setOutOfHomeAccess(false);

      expect(transport.sent).toStrictEqual([
        { method: "GET", path: "/common/get_remote_method" },
        {
          method: "GET",
          path: "/common/set_remote_method",
          query: {
            method: "home only",
            notice_ip_int: "3600",
            notice_sync_int: "60",
          },
        },
      ]);
    });

    it("setMetadata writes the name, icon and group, each to its own endpoint", async () => {
      const transport = adapter({
        "/common/set_name": "ret=OK",
        "/common/set_icon": "ret=OK",
        "/common/set_group": "ret=OK",
      });

      await classicClient(transport).setMetadata({
        name: "Living Room",
        icon: "5",
        group: { name: "Upstairs", enabled: true },
      });

      expect(transport.sent).toEqual([
        {
          method: "GET",
          path: "/common/set_name",
          query: { name: "Living Room" },
        },
        { method: "GET", path: "/common/set_icon", query: { icon: "5" } },
        {
          method: "GET",
          path: "/common/set_group",
          query: { grp_name: "Upstairs", en_grp: "1" },
        },
      ]);
    });

    it("setMetadata writes only the fields it is given", async () => {
      const transport = adapter({ "/common/set_icon": "ret=OK" });
      const client = classicClient(transport);

      await client.setMetadata({ icon: "5" });
      await client.setMetadata({});

      expect(pathsSentTo(transport)).toEqual(["/common/set_icon"]);
    });

    it("reboot sends one GET without a query", async () => {
      const transport = adapter({ "/common/reboot": "ret=OK" });

      await classicClient(transport).reboot();

      expect(transport.sent).toStrictEqual([
        { method: "GET", path: "/common/reboot" },
      ]);
    });

    it("reboot is not sent again after a dropped connection", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(
        failingFirst(1, dropped, () => "ret=OK"),
      );

      await expect(classicClient(transport).reboot()).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(1);
    });
  });

  describe("command", () => {
    it("sends a GET with the parameters as the query, and returns the reply's fields", async () => {
      const transport = adapter({ "/aircon/set_timer": "ret=OK,adv=" });

      const fields = await classicClient(transport).command(
        "/aircon/set_timer",
        { en_timer: "1" },
      );

      expect(fields).toEqual({ ret: "OK", adv: "" });
      expect(transport.sent).toStrictEqual([
        { method: "GET", path: "/aircon/set_timer", query: { en_timer: "1" } },
      ]);
    });

    it("throws a DaikinError with status 502 when the reply's ret is not OK", async () => {
      const transport = adapter({ [GET_CONTROL_INFO]: "ret=PARAM NG" });

      const error = await classicClient(transport)
        .command(GET_CONTROL_INFO)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DaikinError);
      expect(error).toMatchObject({
        httpStatusCode: 502,
        message: expect.stringContaining("ret=PARAM NG"),
      });
    });

    it("throws a DaikinError with status 401 for a wrong child lock code", async () => {
      const transport = adapter({ [GET_CONTROL_INFO]: "ret=LPW NG" });

      await expect(
        classicClient(transport).command(GET_CONTROL_INFO),
      ).rejects.toMatchObject({ httpStatusCode: 401 });
    });

    it("sends the request again after a dropped connection", async () => {
      const transport = new MockDaikinTransport(
        failingFirst(1, new DaikinConnectionError("closed"), () => "ret=OK"),
      );

      await classicClient(transport).command("/common/set_led", { led: "1" });

      expect(transport.sent).toEqual([
        { method: "GET", path: "/common/set_led", query: { led: "1" } },
        { method: "GET", path: "/common/set_led", query: { led: "1" } },
      ]);
    });

    it("does not send the request again after a timeout", async () => {
      const timedOut = new DaikinError("timed out", 504);
      const transport = new MockDaikinTransport(
        failingFirst(1, timedOut, () => "ret=OK"),
      );

      await expect(
        classicClient(transport).command("/common/set_led", { led: "1" }),
      ).rejects.toBe(timedOut);
      expect(transport.sent).toHaveLength(1);
    });

    it("does not send the request again when the reply's ret is not OK", async () => {
      const transport = adapter({ "/common/set_led": "ret=PARAM NG" });

      await expect(
        classicClient(transport).command("/common/set_led", { led: "1" }),
      ).rejects.toBeInstanceOf(DaikinError);
      expect(transport.sent).toHaveLength(1);
    });

    it("sends once when retry is false", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(
        failingFirst(1, dropped, () => "ret=OK"),
      );

      await expect(
        classicClient(transport).command(
          "/common/set_led",
          { led: "1" },
          {
            retry: false,
          },
        ),
      ).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(1);
    });

    it("retries once for each of the constructor's delaysInMs", async () => {
      const dropped = new DaikinConnectionError("closed");
      const transport = new MockDaikinTransport(() => {
        throw dropped;
      });
      const client = new ClassicDaikinClient(transport.asTransport(), {
        delaysInMs: [0, 0],
      });

      await expect(
        client.command("/common/set_led", { led: "1" }),
      ).rejects.toBe(dropped);
      expect(transport.sent).toHaveLength(3);
    });
  });

  describe("close", () => {
    it("closes its transport", async () => {
      const transport = adapter({});

      await classicClient(transport).close();

      expect(transport.closed).toBe(true);
    });
  });
});
