import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaikinAuthentication } from "../authentication.js";
import { DaikinConnectionError, DaikinError } from "../error.js";
import {
  type DaikinRequest,
  DaikinTransport,
  type DaikinTransportOptions,
  withRetry,
} from "../transport.js";
import { TEST_CA, UNRELATED_CA } from "./fixtures/tls.js";
import {
  refusingHost,
  startMockAdapter,
  stopMockAdapters,
} from "./mocks/adapter.js";

const transports: DaikinTransport[] = [];

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  await stopMockAdapters();
});

function transportTo(
  options: Omit<DaikinTransportOptions, "terminalUuid"> & {
    terminalUuid?: string;
  },
): DaikinTransport {
  const transport = new DaikinTransport({
    terminalUuid: "terminal-uuid",
    ...options,
  });
  transports.push(transport);
  return transport;
}

const BASIC_INFO: DaikinRequest = { method: "GET", path: "/common/basic_info" };

describe("DaikinTransport", () => {
  describe("send", () => {
    it("sends the method and path, and returns the reply's body", async () => {
      const adapter = await startMockAdapter("ret=OK,pow=1");

      const body = await transportTo({ host: adapter.host }).send({
        method: "GET",
        path: "/aircon/get_control_info",
      });

      expect(body).toBe("ret=OK,pow=1");
      expect(adapter.received).toMatchObject([
        { method: "GET", url: "/aircon/get_control_info", body: "" },
      ]);
    });

    it("sends the uuid as X-Daikin-uuid, without its dashes", async () => {
      const adapter = await startMockAdapter("ret=OK");

      await transportTo({ host: adapter.host, terminalUuid: "1234-abcd" }).send(
        BASIC_INFO,
      );

      expect(adapter.received[0]?.headers["x-daikin-uuid"]).toBe("1234abcd");
    });

    it("percent-encodes each query key and value, a space as %20", async () => {
      const adapter = await startMockAdapter("ret=OK");

      await transportTo({ host: adapter.host }).send({
        method: "GET",
        path: "/common/set_group",
        query: { method: "home only", "grp name": "a&b=c" },
      });

      expect(adapter.received[0]?.url).toBe(
        "/common/set_group?method=home%20only&grp%20name=a%26b%3Dc",
      );
    });

    it("adds the query and headers its authentication returns", async () => {
      const adapter = await startMockAdapter("ret=OK");
      const authentication: DaikinAuthentication = {
        headers: async () => ({ Authorization: "Basic 1234" }),
        query: async () => ({ lpw: "1234" }),
      };

      await transportTo({ host: adapter.host, authentication }).send({
        ...BASIC_INFO,
        query: { a: "1" },
      });

      expect(adapter.received[0]?.url).toBe("/common/basic_info?a=1&lpw=1234");
      expect(adapter.received[0]?.headers.authorization).toBe("Basic 1234");
    });

    it("replaces a request parameter with the authentication's parameter of the same name", async () => {
      const adapter = await startMockAdapter("ret=OK");
      const authentication: DaikinAuthentication = {
        headers: () => ({}),
        query: () => ({ lpw: "1234" }),
      };

      await transportTo({ host: adapter.host, authentication }).send({
        ...BASIC_INFO,
        query: { lpw: "0000" },
      });

      expect(adapter.received[0]?.url).toBe("/common/basic_info?lpw=1234");
    });

    it("sends a jsonBody as JSON, with its content type", async () => {
      const adapter = await startMockAdapter("{}");

      await transportTo({ host: adapter.host }).send({
        method: "PUT",
        path: "/dsiot/multireq",
        jsonBody: { requests: [] },
      });

      const [request] = adapter.received;
      expect(request?.method).toBe("PUT");
      expect(request?.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(request?.body ?? "")).toEqual({ requests: [] });
    });

    it("sends no content type without a jsonBody", async () => {
      const adapter = await startMockAdapter("ret=OK");

      await transportTo({ host: adapter.host }).send(BASIC_INFO);

      expect(adapter.received[0]?.headers["content-type"]).toBeUndefined();
    });

    it("ignores a trailing slash on the host", async () => {
      const adapter = await startMockAdapter("ret=OK");

      await transportTo({ host: `${adapter.host}/` }).send(BASIC_INFO);

      expect(adapter.received[0]?.url).toBe("/common/basic_info");
    });

    it("throws a DaikinError with the adapter's status when it is not 2xx", async () => {
      const adapter = await startMockAdapter((response) => {
        response.statusCode = 403;
        response.end();
      });

      const error = await transportTo({ host: adapter.host })
        .send(BASIC_INFO)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DaikinError);
      expect(error).not.toBeInstanceOf(DaikinConnectionError);
      expect(error).toMatchObject({ httpStatusCode: 403 });
    });

    it("throws a DaikinConnectionError when the adapter drops the connection", async () => {
      const adapter = await startMockAdapter((response) => {
        response.socket?.destroy();
      });

      await expect(
        transportTo({ host: adapter.host }).send(BASIC_INFO),
      ).rejects.toBeInstanceOf(DaikinConnectionError);
    });

    it("throws a DaikinConnectionError when the adapter refuses the connection", async () => {
      const host = await refusingHost();

      await expect(
        transportTo({ host }).send(BASIC_INFO),
      ).rejects.toBeInstanceOf(DaikinConnectionError);
    });

    it("throws a DaikinError with status 504 when the adapter does not answer within timeoutInMs", async () => {
      const adapter = await startMockAdapter(() => {
        /* never answers */
      });

      const error = await transportTo({ host: adapter.host, timeoutInMs: 100 })
        .send(BASIC_INFO)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DaikinError);
      expect(error).not.toBeInstanceOf(DaikinConnectionError);
      expect(error).toMatchObject({ httpStatusCode: 504 });
    });
  });

  describe("send over HTTPS", () => {
    it("accepts a certificate it cannot verify when given no CA", async () => {
      const adapter = await startMockAdapter("ret=OK", { usesHttps: true });

      await expect(
        transportTo({ host: adapter.host, usesHttps: true }).send(BASIC_INFO),
      ).resolves.toBe("ret=OK");
    });

    it("verifies the chain, not the hostname, when given a CA", async () => {
      const adapter = await startMockAdapter("ret=OK", { usesHttps: true });

      await expect(
        transportTo({
          host: adapter.host,
          usesHttps: true,
          tls: { ca: TEST_CA },
        }).send(BASIC_INFO),
      ).resolves.toBe("ret=OK");
    });

    it("throws a DaikinError with status 504 for a certificate the given CA did not issue", async () => {
      const adapter = await startMockAdapter("ret=OK", { usesHttps: true });

      const error = await transportTo({
        host: adapter.host,
        usesHttps: true,
        tls: { ca: UNRELATED_CA },
      })
        .send(BASIC_INFO)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DaikinError);
      expect(error).not.toBeInstanceOf(DaikinConnectionError);
      expect(error).toMatchObject({ httpStatusCode: 504 });
      expect(adapter.received).toEqual([]);
    });
  });
});

describe("withRetry", () => {
  const dropped = new DaikinConnectionError("closed");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first result without running the operation again", async () => {
    const operation = vi.fn().mockResolvedValue("ret=OK");

    await expect(withRetry(operation)).resolves.toBe("ret=OK");

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("runs the operation again after a DaikinConnectionError", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(dropped)
      .mockRejectedValueOnce(dropped)
      .mockResolvedValue("ret=OK");

    const result = withRetry(operation);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("ret=OK");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("retries at once, then after 50, 100, 200 and 400 ms", async () => {
    const startedAt = Date.now();
    const attemptedAfterInMs: number[] = [];
    const operation = vi.fn(async () => {
      attemptedAfterInMs.push(Date.now() - startedAt);
      throw dropped;
    });

    const result = withRetry(operation).catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    await result;

    expect(attemptedAfterInMs).toEqual([0, 0, 50, 150, 350, 750]);
  });

  it("throws the DaikinConnectionError of the sixth attempt", async () => {
    const last = new DaikinConnectionError("closed for the sixth time");
    const operation = vi.fn().mockRejectedValue(last);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      operation.mockRejectedValueOnce(dropped);
    }

    const result = withRetry(operation).catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();

    expect(await result).toBe(last);
    expect(operation).toHaveBeenCalledTimes(6);
  });

  it("throws any other error at once", async () => {
    const timedOut = new DaikinError("timed out", 504);
    const operation = vi.fn().mockRejectedValue(timedOut);

    await expect(withRetry(operation)).rejects.toBe(timedOut);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries once after each of delaysInMs", async () => {
    const startedAt = Date.now();
    const attemptedAfterInMs: number[] = [];
    const operation = vi.fn(async () => {
      attemptedAfterInMs.push(Date.now() - startedAt);
      throw dropped;
    });

    const result = withRetry(operation, { delaysInMs: [10, 1000] }).catch(
      (caught: unknown) => caught,
    );
    await vi.runAllTimersAsync();
    await result;

    expect(attemptedAfterInMs).toEqual([0, 10, 1010]);
  });

  it("runs the operation once when delaysInMs is empty", async () => {
    const operation = vi.fn().mockRejectedValue(dropped);

    await expect(withRetry(operation, { delaysInMs: [] })).rejects.toBe(
      dropped,
    );

    expect(operation).toHaveBeenCalledTimes(1);
  });
});
