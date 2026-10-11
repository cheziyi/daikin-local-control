import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverDevices } from "../discovery.js";

const createSocket = vi.hoisted(() => vi.fn());

// `discoverDevices` binds UDP port 30000 and broadcasts to the whole LAN, so
// the tests give it a socket that does neither.
vi.mock("node:dgram", () => ({ createSocket }));

class FakeSocket extends EventEmitter {
  readonly bind = vi.fn((_port: number, onBound: () => void) => onBound());
  readonly setBroadcast = vi.fn();
  readonly send = vi.fn();
  private running = true;
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

let socket: FakeSocket;

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  createSocket.mockReturnValue(socket);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("discoverDevices", () => {
  it("binds UDP port 30000 and broadcasts the probe to port 30050", async () => {
    const discovery = discoverDevices();
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.bind).toHaveBeenCalledWith(30000, expect.any(Function));
    expect(socket.setBroadcast).toHaveBeenCalledWith(true);
    expect(socket.send).toHaveBeenCalledWith(
      Buffer.from("DAIKIN_UDP/common/basic_info", "utf8"),
      30050,
      "255.255.255.255",
    );

    await vi.runAllTimersAsync();
    await discovery;
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

  it("keeps the first reply from an address that replies again", async () => {
    const discovery = discoverDevices();
    socket.receive("192.168.1.50", "ret=OK,type=aircon,name=First");
    socket.receive("192.168.1.50", "ret=OK,type=aircon,name=Second");
    await vi.runAllTimersAsync();

    expect(await discovery).toMatchObject([
      { host: "192.168.1.50", name: "First" },
    ]);
  });

  it("resolves with no devices when none reply", async () => {
    const discovery = discoverDevices();
    await vi.runAllTimersAsync();

    expect(await discovery).toEqual([]);
  });

  it("resolves once timeoutInMs has passed, never earlier", async () => {
    const onResolved = vi.fn();
    void discoverDevices({ timeoutInMs: 500 }).then(onResolved);
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
    const error = new Error("bind EADDRINUSE 0.0.0.0:30000");
    const discovery = discoverDevices();
    const rejection = expect(discovery).rejects.toBe(error);

    socket.emit("error", error);
    await rejection;

    expect(socket.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("does not close the socket again once timeoutInMs passes after an error", async () => {
    const error = new Error("bind EADDRINUSE 0.0.0.0:30000");
    const rejection = expect(discoverDevices()).rejects.toBe(error);

    socket.emit("error", error);
    await rejection;
    await vi.runAllTimersAsync();

    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
