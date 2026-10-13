import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverDevices } from "../discovery.js";

const createSocket = vi.hoisted(() => vi.fn());
const isAirbaseAdapter = vi.hoisted(() => vi.fn());
const transports = vi.hoisted(
  () => [] as { options: unknown; close: ReturnType<typeof vi.fn> }[],
);

// `discoverDevices` binds a UDP port and broadcasts to the whole LAN, so the
// tests give it a socket that does neither.
vi.mock("node:dgram", () => ({ createSocket }));
// It asks each classic adapter over HTTP whether it is an Airbase adapter, so
// the tests answer for the adapter.
vi.mock("../clients/airbase.js", () => ({ isAirbaseAdapter }));
vi.mock("../transport.js", () => ({
  DaikinTransport: class {
    readonly close = vi.fn(async () => {});

    constructor(readonly options: unknown) {
      transports.push(this);
    }
  },
}));

class FakeSocket extends EventEmitter {
  // A dgram socket emits `listening` once it is bound, and `error` instead
  // when the bind fails.
  readonly bind = vi.fn((_port: number) => {
    queueMicrotask(() => {
      if (this.bindError === undefined) {
        this.emit("listening");
      } else {
        this.emit("error", this.bindError);
      }
    });
  });
  readonly setBroadcast = vi.fn();
  readonly send = vi.fn();
  private running = true;

  constructor(private readonly bindError?: Error) {
    super();
  }

  // A dgram socket throws when it is closed twice.
  readonly close = vi.fn(() => {
    if (!this.running) {
      throw new Error("Not running");
    }
    this.running = false;
  });

  receive(address: string, payload: string): void {
    this.emit("message", Buffer.from(payload, "utf8"), { address });
  }
}

function addressInUse(): Error {
  return Object.assign(new Error("bind EADDRINUSE"), { code: "EADDRINUSE" });
}

let socket: FakeSocket;

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  createSocket.mockReset();
  createSocket.mockReturnValue(socket);
  isAirbaseAdapter.mockReset();
  isAirbaseAdapter.mockResolvedValue(false);
  transports.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("discoverDevices", () => {
  it("binds UDP port 30000 and broadcasts the probe to port 30050", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);

    expect(createSocket).toHaveBeenCalledWith("udp4");
    expect(socket.bind).toHaveBeenCalledWith(30000);
    expect(socket.setBroadcast).toHaveBeenCalledWith(true);
    expect(socket.send).toHaveBeenCalledWith(
      Buffer.from("DAIKIN_UDP/common/basic_info", "utf8"),
      30050,
      "255.255.255.255",
    );

    await vi.runAllTimersAsync();
    await discovery;
  });

  it("binds the next port when another socket holds one", async () => {
    const held = [
      new FakeSocket(addressInUse()),
      new FakeSocket(addressInUse()),
    ];
    createSocket
      .mockReturnValueOnce(held[0])
      .mockReturnValueOnce(held[1])
      .mockReturnValue(socket);

    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);

    expect(held[0]?.bind).toHaveBeenCalledWith(30000);
    expect(held[1]?.bind).toHaveBeenCalledWith(30001);
    expect(held[0]?.close).toHaveBeenCalledTimes(1);
    expect(held[1]?.close).toHaveBeenCalledTimes(1);
    expect(socket.bind).toHaveBeenCalledWith(30002);
    expect(socket.send).toHaveBeenCalledTimes(1);

    socket.receive("192.168.1.50", "ret=OK,type=aircon");
    await vi.runAllTimersAsync();
    expect(await discovery).toMatchObject([{ host: "192.168.1.50" }]);
  });

  it("rejects with the last socket's error when every port to 30050 is held", async () => {
    const held: FakeSocket[] = [];
    createSocket.mockImplementation(() => {
      const next = new FakeSocket(addressInUse());
      held.push(next);
      return next;
    });

    await expect(discoverDevices()).rejects.toMatchObject({
      code: "EADDRINUSE",
    });

    expect(held).toHaveLength(51);
    expect(held.at(-1)?.bind).toHaveBeenCalledWith(30050);
    expect(held.every((each) => each.close.mock.calls.length === 1)).toBe(true);
  });

  it("rejects with the socket's error when a bind fails another way", async () => {
    const error = Object.assign(new Error("bind EACCES"), { code: "EACCES" });
    const refused = new FakeSocket(error);
    createSocket.mockReturnValue(refused);

    await expect(discoverDevices()).rejects.toBe(error);

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(refused.close).toHaveBeenCalledTimes(1);
  });

  it("sends the probe 10 times, 200 ms apart", async () => {
    const discovery = discoverDevices();

    await vi.advanceTimersByTimeAsync(1799);
    expect(socket.send).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.send).toHaveBeenCalledTimes(10);

    await vi.runAllTimersAsync();
    await discovery;
    expect(socket.send).toHaveBeenCalledTimes(10);
  });

  it("resolves with a device for each address that replies", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);
    socket.receive(
      "192.168.1.50",
      "ret=OK,type=aircon,name=Living%20Room,adp_kind=3,en_secure=1,lpw_flag=0",
    );
    socket.receive("192.168.1.51", "ret=OK,type=GPF,name=Bedroom,lpw_flag=1");
    await vi.runAllTimersAsync();

    expect(await discovery).toEqual([
      {
        host: "192.168.1.50",
        protocol: "classic",
        name: "Living Room",
        requiresRegistration: true,
        usesHttps: true,
        requiresLocalPassword: false,
      },
      {
        host: "192.168.1.51",
        protocol: "dsiot",
        name: "Bedroom",
        requiresRegistration: false,
        usesHttps: false,
        requiresLocalPassword: true,
      },
    ]);
  });

  it("keeps the first reply from a host that replies again", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);
    socket.receive("192.168.1.50", "ret=OK,type=aircon,name=First");
    socket.receive("192.168.1.50", "ret=OK,type=aircon,name=Second");
    socket.receive(
      "192.168.1.51",
      "ret=OK,type=aircon,name=Third,api_port=8080",
    );
    socket.receive(
      "192.168.1.51",
      "ret=OK,type=aircon,name=Fourth,api_port=8080",
    );
    await vi.runAllTimersAsync();

    expect(await discovery).toMatchObject([
      { host: "192.168.1.50", name: "First" },
      { host: "192.168.1.51:8080", name: "Third" },
    ]);
  });

  it("keeps each adapter at one address that announces a port of its own", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);
    socket.receive(
      "127.0.0.1",
      "ret=OK,type=aircon,name=Bedroom,api_port=18101",
    );
    socket.receive("127.0.0.1", "ret=OK,type=GPF,name=Study,api_port=18102");
    socket.receive("127.0.0.1", "ret=OK,type=aircon,name=Hall");
    await vi.runAllTimersAsync();

    expect(await discovery).toMatchObject([
      { host: "127.0.0.1:18101", protocol: "classic", name: "Bedroom" },
      { host: "127.0.0.1:18102", protocol: "dsiot", name: "Study" },
      { host: "127.0.0.1", protocol: "classic", name: "Hall" },
    ]);
  });

  it("ignores a reply from the adapter of another appliance", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);
    socket.receive("192.168.1.10", "ret=OK,type=cleaner,name=Air+Cleaner");
    socket.receive("192.168.1.11", "ret=OK,type=Water Heater");
    socket.receive("192.168.1.12", "ret=OK,type=GPF,cdev=CJ");
    socket.receive("192.168.1.13", "ret=OK,name=No+type");
    socket.receive("192.168.1.50", "ret=OK,type=aircon");
    socket.receive("192.168.1.51", "ret=OK,type=GPF,cdev=RA");
    await vi.runAllTimersAsync();

    expect(await discovery).toMatchObject([
      { host: "192.168.1.50", protocol: "classic" },
      { host: "192.168.1.51", protocol: "dsiot" },
    ]);
  });

  describe("telling an Airbase adapter from a classic one", () => {
    it("reports the adapter isAirbaseAdapter passes as airbase", async () => {
      isAirbaseAdapter.mockImplementation(
        async (transport: { options: { host: string } }) =>
          transport.options.host === "192.168.1.60",
      );
      const discovery = discoverDevices();
      await vi.advanceTimersByTimeAsync(0);
      socket.receive("192.168.1.50", "ret=OK,type=aircon,name=Bedroom");
      socket.receive("192.168.1.60", "ret=OK,type=aircon,name=Ducted");
      await vi.runAllTimersAsync();

      expect(await discovery).toMatchObject([
        { host: "192.168.1.50", protocol: "classic", name: "Bedroom" },
        { host: "192.168.1.60", protocol: "airbase", name: "Ducted" },
      ]);
    });

    it("asks at the adapter's host and scheme, waits 3000 ms, and closes the connection", async () => {
      const discovery = discoverDevices();
      await vi.advanceTimersByTimeAsync(0);
      socket.receive(
        "192.168.1.50",
        "ret=OK,type=aircon,adp_kind=3,en_secure=1,api_port=8443",
      );
      await vi.runAllTimersAsync();
      await discovery;

      expect(transports.map(({ options }) => options)).toEqual([
        { host: "192.168.1.50:8443", usesHttps: true, timeoutInMs: 3000 },
      ]);
      expect(transports[0]?.close).toHaveBeenCalledTimes(1);
    });

    it("asks an adapter once, however often it replies", async () => {
      const discovery = discoverDevices();
      await vi.advanceTimersByTimeAsync(0);
      socket.receive("192.168.1.50", "ret=OK,type=aircon");
      socket.receive("192.168.1.50", "ret=OK,type=aircon");
      await vi.runAllTimersAsync();
      await discovery;

      expect(isAirbaseAdapter).toHaveBeenCalledTimes(1);
    });

    it("asks no DSIOT adapter", async () => {
      const discovery = discoverDevices();
      await vi.advanceTimersByTimeAsync(0);
      socket.receive("192.168.1.51", "ret=OK,type=GPF");
      await vi.runAllTimersAsync();

      expect(await discovery).toMatchObject([{ protocol: "dsiot" }]);
      expect(isAirbaseAdapter).not.toHaveBeenCalled();
      expect(transports).toEqual([]);
    });

    it("resolves only once each adapter has answered", async () => {
      let answer: (isAirbase: boolean) => void = () => {};
      isAirbaseAdapter.mockReturnValue(
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
      );
      const onResolved = vi.fn();
      void discoverDevices({ timeoutInMs: 500 }).then(onResolved);
      await vi.advanceTimersByTimeAsync(0);
      socket.receive("192.168.1.60", "ret=OK,type=aircon");

      await vi.advanceTimersByTimeAsync(500);
      expect(onResolved).not.toHaveBeenCalled();
      expect(socket.close).toHaveBeenCalledTimes(1);

      answer(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(onResolved).toHaveBeenCalledWith([
        expect.objectContaining({ protocol: "airbase" }),
      ]);
    });
  });

  it("ignores a datagram whose ret is not OK", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);
    socket.receive("192.168.1.9", "hello");
    socket.receive("192.168.1.10", "ret=PARAM NG,type=aircon");
    socket.receive("192.168.1.50", "ret=OK,type=aircon");
    await vi.runAllTimersAsync();

    expect(await discovery).toMatchObject([{ host: "192.168.1.50" }]);
  });

  it("resolves with no devices when none reply", async () => {
    const discovery = discoverDevices();
    await vi.runAllTimersAsync();

    expect(await discovery).toEqual([]);
  });

  it("resolves once timeoutInMs has passed, never earlier", async () => {
    const onResolved = vi.fn();
    void discoverDevices({ timeoutInMs: 500 }).then(onResolved);
    await vi.advanceTimersByTimeAsync(0);
    socket.receive("192.168.1.50", "ret=OK,type=aircon");

    await vi.advanceTimersByTimeAsync(499);
    expect(onResolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("listens for 3000 ms by default", async () => {
    const onResolved = vi.fn();
    void discoverDevices().then(onResolved);

    await vi.advanceTimersByTimeAsync(2999);
    expect(onResolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("stops probing and closes the socket when it resolves", async () => {
    const discovery = discoverDevices({ timeoutInMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await discovery;

    expect(socket.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.send).toHaveBeenCalledTimes(3);
  });

  it("rejects with the socket's error, stops probing and closes the socket", async () => {
    const error = new Error("send ENETUNREACH");
    const discovery = discoverDevices();
    const rejection = expect(discovery).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);

    socket.emit("error", error);
    await rejection;

    expect(socket.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("does not close the socket again once timeoutInMs passes after an error", async () => {
    const error = new Error("send ENETUNREACH");
    const rejection = expect(discoverDevices()).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);

    socket.emit("error", error);
    await rejection;
    await vi.runAllTimersAsync();

    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
