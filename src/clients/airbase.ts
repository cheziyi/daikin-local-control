import {
  mergeAirbaseCapabilityFields,
  parseAirbaseCapabilities,
  parseAirbaseZoneCount,
  takesAirbaseAirside,
  takesAirbaseFanAuto,
} from "../codecs/airbase/capabilities.js";
import {
  applyAirbaseAirside,
  applyAirbaseControl,
  applyAirbaseFanAuto,
  parseAirbaseAirside,
  parseAirbaseFanAuto,
  parseAirbaseSensors,
  parseAirbaseState,
} from "../codecs/airbase/state.js";
import { applyAirbaseZone, parseAirbaseZones } from "../codecs/airbase/zone.js";
import {
  assertClassicOk,
  isClassicOk,
  parseClassicKeyValue,
} from "../codecs/classic/keyValue.js";
import { parseDeviceInfo } from "../codecs/device.js";
import { DaikinError } from "../error.js";
import type { DaikinCapabilities } from "../models/capabilities.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type {
  DaikinControl,
  DaikinSensors,
  DaikinState,
  DaikinStateAndSensors,
  SpecialMode,
} from "../models/state.js";
import type { DaikinZone } from "../models/zone.js";
import {
  type DaikinRequestOptions,
  type DaikinRetryOptions,
  type DaikinTransport,
  withRetry,
} from "../transport.js";
import type { DaikinClient } from "./client.js";
import { SetStateCache } from "./setStateCache.js";

// An Airbase adapter answers the endpoints of a classic adapter under this
// path, and HTTP 404 at the paths a classic adapter answers.
const AIRBASE_ROOT = "/skyfi";

const AIRBASE_ROUTES = {
  basicInfo: "/common/basic_info",
  getModelInfo: "/aircon/get_model_info",
  getControlInfo: "/aircon/get_control_info",
  setControlInfo: "/aircon/set_control_info",
  getSensorInfo: "/aircon/get_sensor_info",
  getZoneSetting: "/aircon/get_zone_setting",
  setZoneSetting: "/aircon/set_zone_setting",
} as const;

const NOT_FOUND = 404;

/** Whether the adapter `transport` reaches is an Airbase adapter: one that
 * answers HTTP 404 at `/common/basic_info`, where a classic adapter answers,
 * and `ret=OK` at `/skyfi/common/basic_info`. It sends the second request
 * only after that 404, and retries a refused or dropped connection as
 * `withRetry` does by default: an adapter drops one while it answers another
 * caller. It resolves with `false` when either request fails any other way.
 * `discoverDevices` calls it, and `src/index.ts` does not export it. */
export async function isAirbaseAdapter(
  transport: DaikinTransport,
): Promise<boolean> {
  const get = (path: string) =>
    withRetry(() => transport.send({ method: "GET", path }));
  try {
    await get(AIRBASE_ROUTES.basicInfo);
    return false;
  } catch (error) {
    if (!(error instanceof DaikinError) || error.httpStatusCode !== NOT_FOUND) {
      return false;
    }
  }
  try {
    return isClassicOk(
      parseClassicKeyValue(
        await get(`${AIRBASE_ROOT}${AIRBASE_ROUTES.basicInfo}`),
      ),
    );
  } catch {
    return false;
  }
}

/** Airbase adapter (BRP15B61), on a ducted unit. Reads and writes are HTTP GET
 * with query parameters, as on a classic adapter, at paths under `/skyfi`.
 * It takes no terminal uuid and no local password. */
export class AirbaseDaikinClient implements DaikinClient {
  // A unit's capabilities don't change, so they are read once.
  private capabilityFields: Promise<Record<string, string>> | undefined;
  private readonly setStateCache: SetStateCache;

  /** `close` closes `transport`, so give each client a transport of its own.
   * `maxStateAgeForSetStateInMs` defaults to 0: see
   * `CreateDaikinClientOptions.maxStateAgeForSetStateInMs`. */
  constructor(
    private readonly transport: DaikinTransport,
    private readonly retryOptions?: DaikinRetryOptions,
    maxStateAgeForSetStateInMs = 0,
  ) {
    this.setStateCache = new SetStateCache(maxStateAgeForSetStateInMs);
  }

  close(): Promise<void> {
    return this.transport.close();
  }

  async getDeviceInfo(): Promise<DaikinDeviceInfo> {
    return parseDeviceInfo(await this.command(AIRBASE_ROUTES.basicInfo));
  }

  async getCapabilities(): Promise<DaikinCapabilities> {
    return parseAirbaseCapabilities(await this.readCapabilityFields());
  }

  async getState(): Promise<DaikinState> {
    return parseAirbaseState(await this.readControlInfo());
  }

  async setState(control: DaikinControl): Promise<void> {
    const current =
      this.setStateCache.get() ??
      (await this.command(AIRBASE_ROUTES.getControlInfo));
    await this.command(
      AIRBASE_ROUTES.setControlInfo,
      applyAirbaseControl(current, control),
    );
  }

  async getSensors(): Promise<DaikinSensors> {
    return parseAirbaseSensors(
      await this.command(AIRBASE_ROUTES.getSensorInfo),
    );
  }

  async getStateAndSensors(): Promise<DaikinStateAndSensors> {
    return { state: await this.getState(), sensors: await this.getSensors() };
  }

  /** Rejects with a `DaikinError` whose status is 501: an Airbase adapter has
   * no known request for a special mode. */
  async setSpecialMode(_mode: SpecialMode, _enabled: boolean): Promise<void> {
    throw new DaikinError("An Airbase adapter takes no special mode", 501);
  }

  // --- extended controls ---------------------------------------------------

  /** Whether fan auto is on: the unit then picks the fan speed itself, up to
   * the one that is set. `null` on a unit that takes no fan auto. */
  async getFanAuto(): Promise<boolean | null> {
    return takesAirbaseFanAuto(await this.readCapabilityFields())
      ? parseAirbaseFanAuto(await this.readControlInfo())
      : null;
  }

  /** Switches fan auto on or off. It switches airside off, and keeps the fan
   * speed. Check `getFanAuto` first: the client sends it to any unit. */
  async setFanAuto(enabled: boolean): Promise<void> {
    await this.command(
      AIRBASE_ROUTES.setControlInfo,
      applyAirbaseFanAuto(
        await this.command(AIRBASE_ROUTES.getControlInfo),
        enabled,
      ),
    );
  }

  /** Whether airside is on. `null` on a unit that takes no airside. */
  async getAirside(): Promise<boolean | null> {
    return takesAirbaseAirside(await this.readCapabilityFields())
      ? parseAirbaseAirside(await this.readControlInfo())
      : null;
  }

  /** Switches airside on or off. Switching it on switches fan auto off and
   * sets the lowest fan speed. Check `getAirside` first: the client sends it
   * to any unit. */
  async setAirside(enabled: boolean): Promise<void> {
    await this.command(
      AIRBASE_ROUTES.setControlInfo,
      applyAirbaseAirside(
        await this.command(AIRBASE_ROUTES.getControlInfo),
        enabled,
      ),
    );
  }

  /** The unit's zones, in the unit's order; empty on a unit without zones,
   * which is not asked for any. */
  async getZones(): Promise<DaikinZone[]> {
    const capabilityFields = await this.readCapabilityFields();
    return parseAirbaseZones(
      await this.readZoneSetting(capabilityFields),
      capabilityFields,
    );
  }

  /** Opens or closes the zone at `index` in `getZones`, counted from 0. It
   * rejects with an `Error` for an index the unit has no zone at. */
  async setZone(index: number, enabled: boolean): Promise<void> {
    const capabilityFields = await this.readCapabilityFields();
    const current = await this.readZoneSetting(capabilityFields);
    await this.command(
      AIRBASE_ROUTES.setZoneSetting,
      applyAirbaseZone(current, capabilityFields, index, enabled),
    );
  }

  /** Calls any endpoint by its path below `/skyfi`, such as
   * `/aircon/get_control_info`, with query parameters, and returns the reply's
   * `key=value` fields. It throws a `DaikinError` when the reply's `ret` is
   * not `OK`. */
  async command(
    path: string,
    parameters?: Record<string, string>,
    { retry = true }: DaikinRequestOptions = {},
  ): Promise<Record<string, string>> {
    const send = () =>
      this.transport.send({
        method: "GET",
        path: `${AIRBASE_ROOT}${path}`,
        ...(parameters ? { query: parameters } : {}),
      });
    try {
      const fields = parseClassicKeyValue(
        await (retry ? withRetry(send, this.retryOptions) : send()),
      );
      assertClassicOk(fields);
      return fields;
    } finally {
      // Every request that changes the unit takes parameters, and any of them
      // may change what `get_control_info` answers, even one that failed: a
      // request that timed out may still have reached the unit.
      if (parameters) {
        this.setStateCache.clear();
      }
    }
  }

  // What a unit without zones answers at `get_zone_setting` is not known, so
  // it is not asked.
  private async readZoneSetting(
    capabilityFields: Record<string, string>,
  ): Promise<Record<string, string>> {
    return parseAirbaseZoneCount(capabilityFields) === 0
      ? {}
      : this.command(AIRBASE_ROUTES.getZoneSetting);
  }

  private async readControlInfo(): Promise<Record<string, string>> {
    const fields = await this.command(AIRBASE_ROUTES.getControlInfo);
    this.setStateCache.set(fields);
    return fields;
  }

  private readCapabilityFields(): Promise<Record<string, string>> {
    this.capabilityFields ??= (async () =>
      mergeAirbaseCapabilityFields(
        await this.command(AIRBASE_ROUTES.basicInfo),
        await this.command(AIRBASE_ROUTES.getModelInfo),
      ))();
    // A failed read is not cached, so the next call tries again.
    this.capabilityFields.catch(() => {
      this.capabilityFields = undefined;
    });
    return this.capabilityFields;
  }
}
