import { afterEach, describe, expect, it } from "vitest";
import { ClassicDaikinClient } from "../clients/classic.js";
import type { DaikinClient } from "../clients/client.js";
import { DsiotDaikinClient } from "../clients/dsiot.js";
import { DaikinConnectionError } from "../error.js";
import {
  type CreateDaikinClientOptions,
  createDaikinClient,
} from "../factory.js";
import type { DaikinDevice } from "../models/device.js";
import { TEST_CA, UNRELATED_CA } from "./fixtures/tls.js";
import { startMockAdapter, stopMockAdapters } from "./mocks/adapter.js";

const clients: DaikinClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await stopMockAdapters();
});

function clientFor(
  device: DaikinDevice,
  options: Partial<CreateDaikinClientOptions> = {},
): DaikinClient {
  const client = createDaikinClient(device, {
    terminalUuid: "0123456789abcdef0123456789abcdef",
    ...options,
  });
  clients.push(client);
  return client;
}

const CLASSIC_REPLY = "ret=OK";
const DSIOT_REPLY = '{"responses":[]}';

describe("createDaikinClient", () => {
  it("builds a ClassicDaikinClient for a classic device", async () => {
    const adapter = await startMockAdapter(CLASSIC_REPLY);

    const client = clientFor({ host: adapter.host, protocol: "classic" });
    await client.getState();

    expect(client).toBeInstanceOf(ClassicDaikinClient);
    expect(adapter.received).toMatchObject([
      {
        method: "GET",
        url: "/aircon/get_control_info",
        headers: { "x-daikin-uuid": "0123456789abcdef0123456789abcdef" },
      },
    ]);
  });

  it("builds a DsiotDaikinClient for a dsiot device", async () => {
    const adapter = await startMockAdapter(DSIOT_REPLY);

    const client = clientFor({ host: adapter.host, protocol: "dsiot" });
    await client.getState();

    expect(client).toBeInstanceOf(DsiotDaikinClient);
    expect(adapter.received).toMatchObject([
      {
        method: "POST",
        url: "/dsiot/multireq",
        headers: { "x-daikin-uuid": "0123456789abcdef0123456789abcdef" },
      },
    ]);
  });

  it("sends a classic adapter the local password as the lpw query", async () => {
    const adapter = await startMockAdapter(CLASSIC_REPLY);

    await clientFor(
      { host: adapter.host, protocol: "classic" },
      { localPassword: "1234" },
    ).getState();

    expect(adapter.received[0]?.url).toBe("/aircon/get_control_info?lpw=1234");
    expect(adapter.received[0]?.headers.authorization).toBeUndefined();
  });

  it("sends a DSIOT adapter the local password as a Basic header", async () => {
    const adapter = await startMockAdapter(DSIOT_REPLY);

    await clientFor(
      { host: adapter.host, protocol: "dsiot" },
      { localPassword: "1234" },
    ).getState();

    expect(adapter.received[0]?.url).toBe("/dsiot/multireq");
    expect(adapter.received[0]?.headers.authorization).toBe("Basic 1234");
  });

  it("sends no password when none is given", async () => {
    const adapter = await startMockAdapter(CLASSIC_REPLY);

    await clientFor({ host: adapter.host, protocol: "classic" }).getState();

    expect(adapter.received[0]?.url).toBe("/aircon/get_control_info");
    expect(adapter.received[0]?.headers.authorization).toBeUndefined();
  });

  it("sends over HTTPS when the device uses it", async () => {
    const adapter = await startMockAdapter(CLASSIC_REPLY, { usesHttps: true });

    await clientFor(
      { host: adapter.host, protocol: "classic", usesHttps: true },
      { tls: { ca: TEST_CA } },
    ).getState();

    expect(adapter.received).toHaveLength(1);
  });

  it("verifies the adapter's certificate against options.tls.ca", async () => {
    const adapter = await startMockAdapter(CLASSIC_REPLY, { usesHttps: true });

    await expect(
      clientFor(
        { host: adapter.host, protocol: "classic", usesHttps: true },
        { tls: { ca: UNRELATED_CA } },
      ).getState(),
    ).rejects.toMatchObject({ httpStatusCode: 504 });
    expect(adapter.received).toEqual([]);
  });

  it("waits options.timeoutInMs for the adapter", async () => {
    const adapter = await startMockAdapter(() => {
      /* never answers */
    });

    const error = await clientFor(
      { host: adapter.host, protocol: "classic" },
      { timeoutInMs: 100 },
    )
      .getState()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ httpStatusCode: 504 });
    expect(error).not.toBeInstanceOf(DaikinConnectionError);
  });

  it.each(["classic", "dsiot"] as const)(
    "retries a %s request once for each of options.retry.delaysInMs",
    async (protocol) => {
      const adapter = await startMockAdapter((response) => {
        response.socket?.destroy();
      });

      await expect(
        clientFor(
          { host: adapter.host, protocol },
          { retry: { delaysInMs: [0] } },
        ).getState(),
      ).rejects.toBeInstanceOf(DaikinConnectionError);
      expect(adapter.received).toHaveLength(2);
    },
  );
});
