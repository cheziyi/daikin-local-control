import {
  ClassicLocalPasswordAuthentication,
  type DaikinAuthentication,
  DsiotLocalPasswordAuthentication,
} from "./authentication.js";
import { AirbaseDaikinClient } from "./clients/airbase.js";
import { ClassicDaikinClient } from "./clients/classic.js";
import type { DaikinClient } from "./clients/client.js";
import { DsiotDaikinClient } from "./clients/dsiot.js";
import type { DaikinDevice } from "./models/device.js";
import {
  type DaikinRetryOptions,
  type DaikinTlsOptions,
  DaikinTransport,
} from "./transport.js";

export interface CreateDaikinClientOptions {
  /** The terminal uuid, sent as `X-Daikin-uuid`: 32 lowercase hexadecimal
   * digits, a UUID without its dashes. Generate one and reuse it: an adapter
   * that requires registration remembers it. An Airbase adapter takes none,
   * so it is neither checked nor sent to one. */
  terminalUuid: string;
  /** The child lock code, for a device whose `requiresLocalPassword` is true.
   * It is not sent to an Airbase adapter, which takes none. */
  localPassword?: string;
  /** How long, in milliseconds, a request waits for the adapter. Defaults to
   * 10000: see `DaikinTransportOptions.timeoutInMs`. */
  timeoutInMs?: number;
  /** The waits between retries of a refused or dropped connection. Defaults to
   * waits of 0, 50, 100, 200 and 400 milliseconds: see
   * `DaikinRetryOptions.delaysInMs`. */
  retry?: DaikinRetryOptions;
  /** How old, in milliseconds, a reply to `getState` or `getStateAndSensors`
   * may be for `setState` to build its write from it instead of reading the
   * unit first. Defaults to 0: `setState` always reads first. It changes no
   * read: `getState` asks the unit every time. The write undoes a change made
   * on the remote control since that reply: see
   * DESIGN.md#the-read-before-a-write. */
  maxStateAgeForSetStateInMs?: number;
  /** HTTPS adapters only. Without a CA the adapter's certificate isn't verified. */
  tls?: DaikinTlsOptions;
}

/** Builds the client for a device: a `DsiotDaikinClient` when
 * `device.protocol` is `dsiot`, an `AirbaseDaikinClient` when it is
 * `airbase`, and a `ClassicDaikinClient` otherwise. The client sends over
 * HTTPS when `device.usesHttps` is set, and sends the local password when
 * `options.localPassword` is given. It throws an `Error` when
 * `options.terminalUuid` is not in the form
 * `CreateDaikinClientOptions.terminalUuid` describes. Call `dispose` on
 * the client when done with the unit, or create it with `await using`. */
export function createDaikinClient(
  device: DaikinDevice,
  options: CreateDaikinClientOptions,
): DaikinClient {
  if (device.protocol === "airbase") {
    return new AirbaseDaikinClient(
      new DaikinTransport({
        host: device.host,
        usesHttps: device.usesHttps,
        timeoutInMs: options.timeoutInMs,
        tls: options.tls,
      }),
      options.retry,
      options.maxStateAgeForSetStateInMs,
    );
  }
  const transport = new DaikinTransport({
    host: device.host,
    usesHttps: device.usesHttps,
    terminalUuid: options.terminalUuid,
    authentication: localPasswordAuthentication(device, options.localPassword),
    timeoutInMs: options.timeoutInMs,
    tls: options.tls,
  });

  return device.protocol === "dsiot"
    ? new DsiotDaikinClient(
        transport,
        options.retry,
        options.maxStateAgeForSetStateInMs,
      )
    : new ClassicDaikinClient(
        transport,
        options.retry,
        options.maxStateAgeForSetStateInMs,
      );
}

function localPasswordAuthentication(
  device: DaikinDevice,
  localPassword: string | undefined,
): DaikinAuthentication | undefined {
  if (localPassword === undefined) {
    return undefined;
  }
  return device.protocol === "dsiot"
    ? new DsiotLocalPasswordAuthentication(localPassword)
    : new ClassicLocalPasswordAuthentication(localPassword);
}
