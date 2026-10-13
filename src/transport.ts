import { Client } from "undici";
import type { DaikinAuthentication } from "./authentication.js";
import { encodeTerminalUuid } from "./codecs/credentials.js";
import { DaikinConnectionError, DaikinError } from "./error.js";

export interface DaikinRequestOptions {
  /** Retry a refused or dropped connection. Defaults to true. Pass false for a
   * request that is not safe to repeat. */
  retry?: boolean;
}

export interface DaikinRetryOptions {
  /** How long, in milliseconds, to wait before each retry, so its length is
   * how many times a request is retried. Defaults to 0, 50, 100, 200 and 400:
   * see DESIGN.md#retries. Pass an empty array to never retry. */
  delaysInMs?: number[];
}

const DEFAULT_RETRY_DELAYS_IN_MS = [0, 50, 100, 200, 400];

/** Runs `operation` again each time it throws a `DaikinConnectionError`, once
 * for each of `delaysInMs`, and throws any other error at once: see
 * DESIGN.md#retries. */
export async function withRetry<ResultT>(
  operation: () => Promise<ResultT>,
  { delaysInMs = DEFAULT_RETRY_DELAYS_IN_MS }: DaikinRetryOptions = {},
): Promise<ResultT> {
  for (const delayInMs of delaysInMs) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DaikinConnectionError)) {
        throw error;
      }
    }
    await sleep(delayInMs);
  }
  return operation();
}

function sleep(delayInMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayInMs));
}

const JSON_CONTENT_HEADERS = {
  "Content-Type": "application/json",
};

const DEFAULT_TIMEOUT_IN_MS = 10_000;

// The codes for a refused, reset or closed connection. Every other failure,
// such as a timeout or a TLS error, is not one.
const CONNECTION_FAILURE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "UND_ERR_SOCKET",
]);

export interface DaikinRequest {
  method: "GET" | "POST" | "PUT";
  /** From the leading `/`, without a query string. */
  path: string;
  /** Unencoded: `send` percent-encodes each key and value. */
  query?: Record<string, string>;
  /** JSON body for DSIOT writes. Classic uses `query` only. */
  jsonBody?: unknown;
}

export interface DaikinTransportOptions {
  /** With `:port` when the adapter announces one. */
  host: string;
  /** HTTPS (a Marvell adapter in secure mode). */
  usesHttps?: boolean;
  /** The terminal uuid, sent as `X-Daikin-uuid` on every call: 32 lowercase
   * hexadecimal digits, a UUID without its dashes. */
  terminalUuid: string;
  authentication?: DaikinAuthentication;
  /** How long, in milliseconds, to wait for each of the connection, the
   * reply's headers and the reply's body before `send` throws a
   * `DaikinError` with status 504. Defaults to 10000. */
  timeoutInMs?: number;
  /** HTTPS adapters only. */
  tls?: DaikinTlsOptions;
}

/** An HTTPS adapter presents a certificate chaining to Daikin's own CA, which
 * this package cannot ship. So by default the certificate is not verified at
 * all; supplying the CA turns chain verification on. */
export interface DaikinTlsOptions {
  /** Daikin's CA certificate (PEM). The chain is then verified against it, but
   * not the hostname: the adapter's certificate doesn't name its LAN address. */
  ca?: string | Buffer;
}

/** The HTTP connection to one adapter. It builds each URL from `host` and
 * `usesHttps`, attaches the uuid header and whatever the
 * `DaikinAuthentication` contributes, and returns the reply's body as text for
 * a codec to parse.
 *
 * It holds one undici connection per adapter, so requests queue rather than
 * run in parallel: these small embedded servers are best talked to one request
 * at a time. */
export class DaikinTransport {
  private readonly origin: string;
  private readonly client: Client;
  private readonly terminalUuidHeaders: Record<string, string>;

  /** Call `close` when done with the adapter. It throws an `Error` when
   * `options.terminalUuid` is not in the form
   * `DaikinTransportOptions.terminalUuid` describes. */
  constructor(private readonly options: DaikinTransportOptions) {
    // Before the Client, so a uuid that throws leaves no connection open.
    this.terminalUuidHeaders = encodeTerminalUuid(options.terminalUuid);

    const scheme = options.usesHttps ? "https" : "http";
    this.origin = `${scheme}://${options.host.replace(/\/+$/, "")}`;

    const timeoutInMs = options.timeoutInMs ?? DEFAULT_TIMEOUT_IN_MS;
    this.client = new Client(this.origin, {
      connect: { timeout: timeoutInMs, ...tlsConnectOptions(options.tls) },
      headersTimeout: timeoutInMs,
      bodyTimeout: timeoutInMs,
    });
  }

  /** Sends one request and returns the reply's body as text. It never retries:
   * wrap the call in `withRetry` for that.
   *
   * It throws a `DaikinConnectionError` when the adapter refuses, resets or
   * closes the connection, and a `DaikinError` with status 504 when the
   * request fails to complete any other way, such as a timeout or a TLS
   * error. A reply whose status is not 2xx makes it throw a `DaikinError`
   * with that status. */
  async send(request: DaikinRequest): Promise<string> {
    const authenticationQuery =
      (await this.options.authentication?.query()) ?? {};
    // Not URLSearchParams: it writes a space as `+`, and the adapter expects
    // `%20` (e.g. `method=home%20only`).
    const query = Object.entries({ ...request.query, ...authenticationQuery })
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");

    const headers: Record<string, string> = {
      ...this.terminalUuidHeaders,
      ...((await this.options.authentication?.headers()) ?? {}),
      ...(request.jsonBody !== undefined ? JSON_CONTENT_HEADERS : {}),
    };

    let statusCode: number;
    let text: string;
    try {
      const response = await this.client.request({
        method: request.method,
        path: query ? `${request.path}?${query}` : request.path,
        headers,
        ...(request.jsonBody !== undefined
          ? { body: JSON.stringify(request.jsonBody) }
          : {}),
      });
      statusCode = response.statusCode;
      text = await response.body.text();
    } catch (error) {
      const message = `Daikin request to ${request.path} did not complete: ${String(error)}`;
      if (
        CONNECTION_FAILURE_CODES.has(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw new DaikinConnectionError(message);
      }
      throw new DaikinError(message, 504);
    }

    if (statusCode < 200 || statusCode >= 300) {
      // The classic protocol signals logical failures in the body with HTTP 200,
      // so an HTTP error here is a transport-level one.
      throw new DaikinError(
        `Daikin request to ${request.path} failed`,
        statusCode,
      );
    }
    return text;
  }

  /** Close the connection to the adapter. */
  async close(): Promise<void> {
    await this.client.close();
  }
}

function tlsConnectOptions(tls: DaikinTlsOptions | undefined) {
  return tls?.ca === undefined
    ? { rejectUnauthorized: false }
    : { ca: tls.ca, checkServerIdentity: () => undefined };
}
