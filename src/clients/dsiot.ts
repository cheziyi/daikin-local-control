import { parseDsiotCapabilities } from "../codecs/dsiot/capabilities.js";
import { parseDsiotDeviceInfo } from "../codecs/dsiot/device.js";
import {
  buildDsiotMultireqGet,
  buildDsiotMultireqUpdate,
  type DsiotUpdate,
  parseDsiotMultireqReply,
} from "../codecs/dsiot/multireq.js";
import {
  applyDsiotControl,
  buildDsiotSpecialModeUpdate,
  parseDsiotSensors,
  parseDsiotState,
} from "../codecs/dsiot/state.js";
import { DSIOT_TARGETS } from "../codecs/dsiot/tables.js";
import type { DaikinCapabilities } from "../models/capabilities.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type {
  DaikinControl,
  DaikinSensors,
  DaikinState,
  DaikinStateAndSensors,
  SpecialMode,
} from "../models/state.js";
import {
  type DaikinRequestOptions,
  type DaikinRetryOptions,
  type DaikinTransport,
  withRetry,
} from "../transport.js";
import type { DaikinClient } from "./client.js";
import { SetStateCache } from "./setStateCache.js";

// DSIOT endpoints (BRP084-style). Climate state is a POST (read) or PUT (write)
// of a JSON property tree to `multireq`.
const DSIOT_ROUTES = {
  multireq: "/dsiot/multireq",
  reboot: "/config/system/reboot",
} as const;

/** DSIOT adapter (BRP084-style). One endpoint, `/dsiot/multireq`: POST to read
 * whole `dgc_status` trees, PUT to write one merged tree. */
export class DsiotDaikinClient implements DaikinClient {
  private readonly setStateCache: SetStateCache;

  /** `dispose` closes `transport`, so give each client a transport of its own.
   * `maxStateAgeForSetStateInMs` defaults to 0: see
   * `CreateDaikinClientOptions.maxStateAgeForSetStateInMs`. */
  constructor(
    private readonly transport: DaikinTransport,
    private readonly retryOptions?: DaikinRetryOptions,
    maxStateAgeForSetStateInMs = 0,
  ) {
    this.setStateCache = new SetStateCache(maxStateAgeForSetStateInMs);
  }

  dispose(): Promise<void> {
    return this.transport.dispose();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  async getDeviceInfo(): Promise<DaikinDeviceInfo> {
    return parseDsiotDeviceInfo(
      await this.multireqGet([
        DSIOT_TARGETS.adapterInfo,
        DSIOT_TARGETS.adapterSettings,
      ]),
    );
  }

  async getCapabilities(): Promise<DaikinCapabilities> {
    return parseDsiotCapabilities(
      await this.multireqGet([
        DSIOT_TARGETS.adapterInfo,
        DSIOT_TARGETS.indoorStatus,
        DSIOT_TARGETS.outdoorStatus,
      ]),
    );
  }

  async getState(): Promise<DaikinState> {
    return parseDsiotState(await this.readStatus());
  }

  async setState(control: DaikinControl): Promise<void> {
    const values =
      this.setStateCache.get() ??
      (await this.multireqGet([DSIOT_TARGETS.indoorStatus]));
    await this.multireqUpdate(applyDsiotControl(values, control));
  }

  async getSensors(): Promise<DaikinSensors> {
    return parseDsiotSensors(
      await this.multireqGet([
        DSIOT_TARGETS.indoorStatus,
        DSIOT_TARGETS.outdoorStatus,
      ]),
    );
  }

  async getStateAndSensors(): Promise<DaikinStateAndSensors> {
    const values = await this.readStatus();
    return {
      state: parseDsiotState(values),
      sensors: parseDsiotSensors(values),
    };
  }

  /** One leaf of `dgc_status`, on the outdoor unit for powerful. */
  async setSpecialMode(mode: SpecialMode, enabled: boolean): Promise<void> {
    await this.multireq("PUT", buildDsiotSpecialModeUpdate(mode, enabled));
  }

  // --- extended controls ---------------------------------------------------

  /** Reboot the adapter (`/config/system/reboot`). */
  async reboot(): Promise<void> {
    await this.transport.send({
      method: "POST",
      path: DSIOT_ROUTES.reboot,
    });
  }

  /** Raw multireq read of whole resources (`DSIOT_TARGETS` values or any `to`),
   * flattened to dotted path -> value. */
  async multireqGet(
    targets: string[],
    options?: DaikinRequestOptions,
  ): Promise<Record<string, string>> {
    return this.multireq("POST", buildDsiotMultireqGet(targets), options);
  }

  /** Raw multireq write: update any leaves by dotted path, merged into one tree
   * on the indoor edge. Returns the reply, flattened as `multireqGet` does. */
  async multireqUpdate(
    updates: DsiotUpdate[],
    options?: DaikinRequestOptions,
  ): Promise<Record<string, string>> {
    return this.multireq("PUT", buildDsiotMultireqUpdate(updates), options);
  }

  private async multireq(
    method: "POST" | "PUT",
    jsonBody: unknown,
    { retry = true }: DaikinRequestOptions = {},
  ): Promise<Record<string, string>> {
    const send = () =>
      this.transport.send({ method, path: DSIOT_ROUTES.multireq, jsonBody });
    try {
      return parseDsiotMultireqReply(
        await (retry ? withRetry(send, this.retryOptions) : send()),
      );
    } finally {
      // Even a write that failed: one that timed out may still have reached
      // the unit.
      if (method === "PUT") {
        this.setStateCache.clear();
      }
    }
  }

  private async readStatus(): Promise<Record<string, string>> {
    const values = await this.multireqGet([
      DSIOT_TARGETS.indoorStatus,
      DSIOT_TARGETS.outdoorStatus,
    ]);
    this.setStateCache.set(values);
    return values;
  }
}
