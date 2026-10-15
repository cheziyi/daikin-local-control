import {
  mergeClassicCapabilityFields,
  parseClassicCapabilities,
} from "../codecs/classic/capabilities.js";
import {
  applyClassicOutOfHomeAccess,
  encodeClassicDemandControl,
  encodeClassicEnergyPrice,
  encodeClassicEnergyTarget,
  encodeClassicGroup,
  encodeClassicHolidayMode,
  encodeClassicIcon,
  encodeClassicLed,
  encodeClassicName,
  encodeClassicSpecialMode,
  encodeClassicTerminalKey,
  encodeClassicTerminalScope,
  parseClassicHolidayMode,
  parseClassicLed,
  parseClassicMetadata,
  parseClassicOutOfHomeAccess,
} from "../codecs/classic/extendedControl.js";
import {
  assertClassicOk,
  parseClassicKeyValue,
} from "../codecs/classic/keyValue.js";
import {
  applyClassicControl,
  parseClassicSensors,
  parseClassicState,
} from "../codecs/classic/state.js";
import { parseDeviceInfo } from "../codecs/device.js";
import type { DaikinCapabilities } from "../models/capabilities.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type {
  DemandControl,
  DeviceMetadata,
  TerminalScope,
} from "../models/extendedControl.js";
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

// Classic CGI endpoints (BRP069-style). Reads and writes are both HTTP GET with
// query parameters; the reply is `key=value,key=value`.
const CLASSIC_ROUTES = {
  basicInfo: "/common/basic_info",
  getModelInfo: "/aircon/get_model_info",
  getControlInfo: "/aircon/get_control_info",
  setControlInfo: "/aircon/set_control_info",
  getSensorInfo: "/aircon/get_sensor_info",
  setSpecialMode: "/aircon/set_special_mode",
  setDemandControl: "/aircon/set_demand_control",
  setPrice: "/aircon/set_price",
  setTarget: "/aircon/set_target",
  setLed: "/common/set_led",
  setHoliday: "/common/set_holiday",
  setName: "/common/set_name",
  setIcon: "/common/set_icon",
  setGroup: "/common/set_group",
  getRemoteMethod: "/common/get_remote_method",
  setRemoteMethod: "/common/set_remote_method",
  reboot: "/common/reboot",
  registerTerminal: "/common/register_terminal",
  unregisterTerminal: "/common/unregister_terminal",
} as const;

/** Classic CGI adapter (BRP069-style). Reads and writes are HTTP GET with query
 * parameters; replies are `key=value,key=value`. */
export class ClassicDaikinClient implements DaikinClient {
  // A unit's capabilities don't change, and `setState` needs them, so they are
  // read once.
  private capabilityFields: Promise<Record<string, string>> | undefined;
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
    return parseDeviceInfo(await this.command(CLASSIC_ROUTES.basicInfo));
  }

  async getCapabilities(): Promise<DaikinCapabilities> {
    return parseClassicCapabilities(await this.readCapabilityFields());
  }

  async getState(): Promise<DaikinState> {
    return parseClassicState(await this.readControlInfo());
  }

  async setState(control: DaikinControl): Promise<void> {
    const capabilityFields = await this.readCapabilityFields();
    const current =
      this.setStateCache.get() ??
      (await this.command(CLASSIC_ROUTES.getControlInfo));
    await this.command(
      CLASSIC_ROUTES.setControlInfo,
      applyClassicControl(current, control, capabilityFields),
    );
  }

  async getSensors(): Promise<DaikinSensors> {
    return parseClassicSensors(
      await this.command(CLASSIC_ROUTES.getSensorInfo),
    );
  }

  async getStateAndSensors(): Promise<DaikinStateAndSensors> {
    return { state: await this.getState(), sensors: await this.getSensors() };
  }

  /** `set_special_mode`, an endpoint of its own beside `set_control_info`. */
  async setSpecialMode(mode: SpecialMode, enabled: boolean): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.setSpecialMode,
      encodeClassicSpecialMode(mode, enabled),
    );
  }

  // --- extended controls ---------------------------------------------------
  // Each write goes to its own endpoint, not `set_control_info`.

  /** Whether the adapter's status LED is on (`basic_info`): `null` when the
   * adapter does not report it. */
  async getLed(): Promise<boolean | null> {
    return parseClassicLed(await this.command(CLASSIC_ROUTES.basicInfo));
  }

  /** Adapter status LED on/off (`set_led`). */
  async setLed(on: boolean): Promise<void> {
    await this.command(CLASSIC_ROUTES.setLed, encodeClassicLed(on));
  }

  /** Whether holiday mode is on (`basic_info`): `null` when the adapter does
   * not report it. */
  async getHolidayMode(): Promise<boolean | null> {
    return parseClassicHolidayMode(
      await this.command(CLASSIC_ROUTES.basicInfo),
    );
  }

  /** Holiday / away mode (`set_holiday`). */
  async setHolidayMode(enabled: boolean): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.setHoliday,
      encodeClassicHolidayMode(enabled),
    );
  }

  /** Demand control — cap the unit's power draw (`set_demand_control`). */
  async setDemandControl(demand: DemandControl): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.setDemandControl,
      encodeClassicDemandControl(demand),
    );
  }

  /** Whether the unit can be operated from outside the home network
   * (`basic_info`): `null` when the adapter does not report it. */
  async getOutOfHomeAccess(): Promise<boolean | null> {
    return parseClassicOutOfHomeAccess(
      await this.command(CLASSIC_ROUTES.basicInfo),
    );
  }

  /** Whether the unit can be operated from outside the home network
   * (`set_remote_method`). */
  async setOutOfHomeAccess(enabled: boolean): Promise<void> {
    const current = await this.command(CLASSIC_ROUTES.getRemoteMethod);
    await this.command(
      CLASSIC_ROUTES.setRemoteMethod,
      applyClassicOutOfHomeAccess(current, enabled),
    );
  }

  /** Electricity price per kWh for the consumption estimates (`set_price`),
   * to two decimal places. */
  async setEnergyPrice(price: number): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.setPrice,
      encodeClassicEnergyPrice(price),
    );
  }

  /** Energy target for the "target" feature (`set_target`). */
  async setEnergyTarget(target: number): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.setTarget,
      encodeClassicEnergyTarget(target),
    );
  }

  /** Name / icon / group metadata (`basic_info`). */
  async getMetadata(): Promise<DeviceMetadata> {
    return parseClassicMetadata(await this.command(CLASSIC_ROUTES.basicInfo));
  }

  /** Name / icon / group metadata (`set_name` etc.). */
  async setMetadata(metadata: DeviceMetadata): Promise<void> {
    if (metadata.name !== undefined) {
      await this.command(
        CLASSIC_ROUTES.setName,
        encodeClassicName(metadata.name),
      );
    }
    if (metadata.icon !== undefined) {
      await this.command(
        CLASSIC_ROUTES.setIcon,
        encodeClassicIcon(metadata.icon),
      );
    }
    if (metadata.group !== undefined) {
      await this.command(
        CLASSIC_ROUTES.setGroup,
        encodeClassicGroup(metadata.group),
      );
    }
  }

  /** Register this client's uuid with an adapter whose
   * `requiresRegistration` is true, using the KEY printed on the adapter's
   * label (`register_terminal`). Once per uuid; the adapter remembers it. */
  async registerTerminal(key: string): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.registerTerminal,
      encodeClassicTerminalKey(key),
    );
  }

  /** Unregister terminals (`unregister_terminal`): this uuid, every other
   * uuid, or all of them. */
  async unregisterTerminal(scope: TerminalScope = "self"): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.unregisterTerminal,
      encodeClassicTerminalScope(scope),
    );
  }

  /** Reboot the adapter (`reboot`). */
  async reboot(): Promise<void> {
    await this.command(CLASSIC_ROUTES.reboot, undefined, { retry: false });
  }

  /** Calls any classic CGI endpoint with query parameters and returns the reply's
   * `key=value` fields. It reaches the controls without a typed method:
   * timers, schedules, programs, network, credentials and firmware. It throws
   * a `DaikinError` when the reply's `ret` is not `OK`. */
  async command(
    path: string,
    parameters?: Record<string, string>,
    { retry = true }: DaikinRequestOptions = {},
  ): Promise<Record<string, string>> {
    const send = () =>
      this.transport.send({
        method: "GET",
        path,
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

  private async readControlInfo(): Promise<Record<string, string>> {
    const fields = await this.command(CLASSIC_ROUTES.getControlInfo);
    this.setStateCache.set(fields);
    return fields;
  }

  private readCapabilityFields(): Promise<Record<string, string>> {
    this.capabilityFields ??= (async () =>
      mergeClassicCapabilityFields(
        await this.command(CLASSIC_ROUTES.basicInfo),
        await this.command(CLASSIC_ROUTES.getModelInfo),
      ))();
    // A failed read is not cached, so the next call tries again.
    this.capabilityFields.catch(() => {
      this.capabilityFields = undefined;
    });
    return this.capabilityFields;
  }
}
