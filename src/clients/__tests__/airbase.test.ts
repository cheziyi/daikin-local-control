import { afterEach, describe, expect, it, vi } from "vitest";
import { DaikinConnectionError, DaikinError } from "../../error.js";
import { AirbaseDaikinClient, isAirbaseAdapter } from "../airbase.js";
import { failingFirst, MockDaikinTransport } from "./mocks/transport.js";

const BASIC_INFO = "/skyfi/common/basic_info";
const GET_MODEL_INFO = "/skyfi/aircon/get_model_info";
const GET_CONTROL_INFO = "/skyfi/aircon/get_control_info";
const SET_CONTROL_INFO = "/skyfi/aircon/set_control_info";
const GET_SENSOR_INFO = "/skyfi/aircon/get_sensor_info";
const GET_ZONE_SETTING = "/skyfi/aircon/get_zone_setting";
const SET_ZONE_SETTING = "/skyfi/aircon/set_zone_setting";

// A unit with two zones, running in cool at 24 °C on the middle fan speed.
const UNIT = {
  [BASIC_INFO]:
    "ret=OK,type=aircon,reg=au,ver=1_1_8,name=Home%20AC,mac=A408EACC91D4",
  [GET_MODEL_INFO]:
    "ret=OK,model=NOTSUPPORT,en_frate=1,frate_steps=3,en_zone=2,en_airside=1",
  [GET_CONTROL_INFO]:
    "ret=OK,pow=1,mode=2,stemp=24.0,shum=0,f_rate=3,f_auto=0,f_airside=0,f_dir=0,bk_auto=2,dt1=21.0,dt2=24.0,dfr1=5,dfr2=3",
  [SET_CONTROL_INFO]: "ret=OK",
  [GET_SENSOR_INFO]: "ret=OK,htemp=26.0,otemp=-",
  [GET_ZONE_SETTING]:
    "ret=OK,zone_name=Living%3bBedrooms%3bZone3,zone_onoff=1%3b0%3b0",
  [SET_ZONE_SETTING]: "ret=OK",
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

function airbaseClient(transport: MockDaikinTransport): AirbaseDaikinClient {
  return new AirbaseDaikinClient(transport.asTransport());
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

describe("AirbaseDaikinClient", () => {
  it("reads the device info from basic_info under /skyfi", async () => {
    const transport = adapter(UNIT);

    expect(await airbaseClient(transport).getDeviceInfo()).toEqual({
      name: "Home AC",
      macAddress: "A4:08:EA:CC:91:D4",
      firmwareVersion: "1.1.8",
    });
    expect(transport.sent).toEqual([{ method: "GET", path: BASIC_INFO }]);
  });

  it("reads get_control_info into a DaikinState", async () => {
    const transport = adapter(UNIT);

    expect(await airbaseClient(transport).getState()).toMatchObject({
      power: true,
      mode: "cool",
      targetTemperatureInC: 24,
      fanSpeed: "level3",
    });
    expect(pathsSentTo(transport)).toEqual([GET_CONTROL_INFO]);
  });

  it("reads the sensors, and both with getStateAndSensors", async () => {
    const transport = adapter(UNIT);
    const client = airbaseClient(transport);

    expect(await client.getSensors()).toEqual({
      indoorTemperatureInC: 26,
      outdoorTemperatureInC: null,
      indoorHumidityInPercent: null,
    });
    expect(await client.getStateAndSensors()).toMatchObject({
      state: { mode: "cool" },
      sensors: { indoorTemperatureInC: 26 },
    });
  });

  it("reads the capabilities from basic_info and get_model_info, once", async () => {
    const transport = adapter(UNIT);
    const client = airbaseClient(transport);

    expect(await client.getCapabilities()).toMatchObject({
      modes: ["cool", "heat", "fan"],
      fanSpeeds: ["level1", "level3", "level5"],
      model: "NOTSUPPORT",
    });
    await client.getCapabilities();

    expect(pathsSentTo(transport)).toEqual([BASIC_INFO, GET_MODEL_INFO]);
  });

  it("reads the unit, then writes the control over what it holds", async () => {
    const transport = adapter(UNIT);

    await airbaseClient(transport).setState({ mode: "heat" });

    expect(pathsSentTo(transport)).toEqual([
      GET_CONTROL_INFO,
      SET_CONTROL_INFO,
    ]);
    expect(queriesSentTo(transport, SET_CONTROL_INFO)).toEqual([
      {
        pow: "1",
        mode: "1",
        bk_auto: "1",
        stemp: "21.0",
        dt1: "21.0",
        shum: "0",
        f_rate: "5",
        f_auto: "0",
        f_airside: "0",
        f_dir: "0",
      },
    ]);
  });

  it("builds a write from a getState reply younger than maxStateAgeForSetStateInMs", async () => {
    const transport = adapter(UNIT);
    const client = new AirbaseDaikinClient(
      transport.asTransport(),
      undefined,
      60_000,
    );

    await client.getState();
    await client.setState({ power: false });
    await client.setState({ power: true });

    expect(pathsSentTo(transport)).toEqual([
      GET_CONTROL_INFO,
      SET_CONTROL_INFO,
      GET_CONTROL_INFO,
      SET_CONTROL_INFO,
    ]);
  });

  it("rejects setSpecialMode with status 501, and sends nothing", async () => {
    const transport = adapter(UNIT);

    await expect(
      airbaseClient(transport).setSpecialMode("powerful", true),
    ).rejects.toMatchObject({
      name: "DaikinError",
      httpStatusCode: 501,
    });
    expect(transport.sent).toEqual([]);
  });

  describe("fan auto and airside", () => {
    it("reads each on a unit that takes it", async () => {
      const transport = adapter({
        ...UNIT,
        [GET_CONTROL_INFO]: `${UNIT[GET_CONTROL_INFO]},f_auto=1`,
      });
      const client = airbaseClient(transport);

      expect(await client.getFanAuto()).toBe(true);
      expect(await client.getAirside()).toBe(false);
    });

    it("reads null on a unit that takes neither, without reading its state", async () => {
      const transport = adapter({
        ...UNIT,
        [GET_MODEL_INFO]: "ret=OK,en_frate=1,frate_steps=3",
      });
      const client = airbaseClient(transport);

      expect(await client.getFanAuto()).toBeNull();
      expect(await client.getAirside()).toBeNull();
      expect(pathsSentTo(transport)).toEqual([BASIC_INFO, GET_MODEL_INFO]);
    });

    it("switches fan auto with a set_control_info of its own", async () => {
      const transport = adapter(UNIT);

      await airbaseClient(transport).setFanAuto(true);

      expect(pathsSentTo(transport)).toEqual([
        GET_CONTROL_INFO,
        SET_CONTROL_INFO,
      ]);
      expect(queriesSentTo(transport, SET_CONTROL_INFO)).toMatchObject([
        { f_rate: "3", f_auto: "1", auto2: "1", f_airside: "0" },
      ]);
    });

    it("switches airside with a set_control_info of its own", async () => {
      const transport = adapter(UNIT);

      await airbaseClient(transport).setAirside(true);

      expect(queriesSentTo(transport, SET_CONTROL_INFO)).toMatchObject([
        { f_rate: "1", f_auto: "0", f_airside: "1", airside2: "1" },
      ]);
    });

    it("reads the unit before each, whatever maxStateAgeForSetStateInMs is", async () => {
      const transport = adapter(UNIT);
      const client = new AirbaseDaikinClient(
        transport.asTransport(),
        undefined,
        60_000,
      );

      await client.getState();
      await client.setFanAuto(true);

      expect(pathsSentTo(transport)).toEqual([
        GET_CONTROL_INFO,
        GET_CONTROL_INFO,
        SET_CONTROL_INFO,
      ]);
    });
  });

  describe("zones", () => {
    it("reads as many zones as the unit has", async () => {
      const transport = adapter(UNIT);

      expect(await airbaseClient(transport).getZones()).toEqual([
        { name: "Living", enabled: true },
        { name: "Bedrooms", enabled: false },
      ]);
    });

    it("reads the zones, then writes them back with one changed", async () => {
      const transport = adapter(UNIT);

      await airbaseClient(transport).setZone(1, true);

      expect(pathsSentTo(transport).slice(-2)).toEqual([
        GET_ZONE_SETTING,
        SET_ZONE_SETTING,
      ]);
      expect(queriesSentTo(transport, SET_ZONE_SETTING)).toEqual([
        { zone_name: "Living;Bedrooms;Zone3", zone_onoff: "1;1;0" },
      ]);
    });

    it("rejects with an Error for a zone the unit lacks, and writes nothing", async () => {
      const transport = adapter(UNIT);

      await expect(airbaseClient(transport).setZone(2, true)).rejects.toThrow(
        "The unit has no zone 2: it has 2",
      );
      expect(pathsSentTo(transport)).not.toContain(SET_ZONE_SETTING);
    });
  });

  describe("command", () => {
    it("calls the path below /skyfi, and returns the reply's fields", async () => {
      const transport = adapter({
        "/skyfi/common/get_holiday": "ret=OK,en_hol=0",
      });

      expect(
        await airbaseClient(transport).command("/common/get_holiday"),
      ).toEqual({ ret: "OK", en_hol: "0" });
    });

    it("rejects with a DaikinError when ret is not OK", async () => {
      const transport = adapter({ [GET_CONTROL_INFO]: "ret=PARAM NG" });

      await expect(airbaseClient(transport).getState()).rejects.toMatchObject({
        name: "DaikinError",
        httpStatusCode: 502,
      });
    });

    it("retries a dropped connection, unless told not to", async () => {
      const dropped = new DaikinConnectionError("closed");
      const reply = () => "ret=OK";
      const retried = new MockDaikinTransport(failingFirst(1, dropped, reply));
      const single = new MockDaikinTransport(failingFirst(1, dropped, reply));

      await new AirbaseDaikinClient(retried.asTransport(), {
        delaysInMs: [0],
      }).command("/common/basic_info");
      await expect(
        airbaseClient(single).command("/common/basic_info", undefined, {
          retry: false,
        }),
      ).rejects.toBe(dropped);

      expect(retried.sent).toHaveLength(2);
      expect(single.sent).toHaveLength(1);
    });
  });

  it("closes its transport", async () => {
    const transport = adapter(UNIT);

    await airbaseClient(transport).close();

    expect(transport.closed).toBe(true);
  });
});

describe("isAirbaseAdapter", () => {
  const notFound = new DaikinError("Not found", 404);

  afterEach(() => {
    vi.useRealTimers();
  });

  // Answers 404 at each path it has no body for.
  function answering(bodies: Record<string, string>): MockDaikinTransport {
    return new MockDaikinTransport(({ path }) => {
      const body = bodies[path];
      if (body === undefined) {
        throw notFound;
      }
      return body;
    });
  }

  it("passes an adapter that answers 404 at /common/basic_info and OK under /skyfi", async () => {
    const transport = answering({ [BASIC_INFO]: "ret=OK,type=aircon" });

    expect(await isAirbaseAdapter(transport.asTransport())).toBe(true);
    expect(transport.sent).toEqual([
      { method: "GET", path: "/common/basic_info" },
      { method: "GET", path: BASIC_INFO },
    ]);
  });

  it("passes no adapter that answers /common/basic_info, and asks it nothing more", async () => {
    const transport = answering({ "/common/basic_info": "ret=OK,type=aircon" });

    expect(await isAirbaseAdapter(transport.asTransport())).toBe(false);
    expect(transport.sent).toHaveLength(1);
  });

  it("passes no adapter that rejects the first request another way, and asks it once", async () => {
    for (const error of [
      new DaikinError("Forbidden", 403),
      new DaikinError("Timed out", 504),
    ]) {
      const transport = new MockDaikinTransport(() => {
        throw error;
      });

      expect(await isAirbaseAdapter(transport.asTransport())).toBe(false);
      expect(transport.sent).toHaveLength(1);
    }
  });

  it("asks again after a dropped connection, at either path", async () => {
    const dropped = new DaikinConnectionError("closed");
    let skyfiFailures = 1;
    const airbase = new MockDaikinTransport(
      failingFirst(1, dropped, ({ path }) => {
        if (path !== BASIC_INFO) {
          throw notFound;
        }
        if (skyfiFailures > 0) {
          skyfiFailures -= 1;
          throw dropped;
        }
        return "ret=OK,type=aircon";
      }),
    );
    const classic = new MockDaikinTransport(
      failingFirst(1, dropped, () => "ret=OK,type=aircon"),
    );

    expect(await isAirbaseAdapter(airbase.asTransport())).toBe(true);
    expect(await isAirbaseAdapter(classic.asTransport())).toBe(false);
    expect(airbase.sent.map(({ path }) => path)).toEqual([
      "/common/basic_info",
      "/common/basic_info",
      BASIC_INFO,
      BASIC_INFO,
    ]);
    expect(classic.sent).toHaveLength(2);
  });

  it("passes no adapter that keeps dropping the connection, after five retries", async () => {
    vi.useFakeTimers();
    const transport = new MockDaikinTransport(() => {
      throw new DaikinConnectionError("refused");
    });

    const identified = isAirbaseAdapter(transport.asTransport());
    await vi.runAllTimersAsync();

    expect(await identified).toBe(false);
    expect(transport.sent).toHaveLength(6);
  });

  it("passes no adapter that answers 404 at both paths, or a ret other than OK", async () => {
    expect(await isAirbaseAdapter(answering({}).asTransport())).toBe(false);
    expect(
      await isAirbaseAdapter(
        answering({ [BASIC_INFO]: "ret=PARAM NG" }).asTransport(),
      ),
    ).toBe(false);
  });
});
