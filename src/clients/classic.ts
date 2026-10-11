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
import type { DaikinCapabilities } from "../models/capabilities.js";
import type {
  DemandControl,
  DeviceMetadata,
  SpecialMode,
  TerminalScope,
} from "../models/extendedControl.js";
import type {
  DaikinControl,
  DaikinSensors,
  DaikinState,
} from "../models/state.js";
import {
  type DaikinRequestOptions,
  type DaikinRetryOptions,
  type DaikinTransport,
  withRetry,
} from "../transport.js";
import type { DaikinClient } from "./client.js";

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

  /** `close` closes `transport`, so give each client a transport of its own. */
  constructor(
    private readonly transport: DaikinTransport,
    private readonly retryOptions?: DaikinRetryOptions,
  ) {}

  close(): Promise<void> {
    return this.transport.close();
  }

  async getCapabilities(): Promise<DaikinCapabilities> {
    return parseClassicCapabilities(await this.readCapabilityFields());
  }

  async getState(): Promise<DaikinState> {
    return parseClassicState(await this.command(CLASSIC_ROUTES.getControlInfo));
  }

  async setState(control: DaikinControl): Promise<void> {
    const capabilityFields = await this.readCapabilityFields();
    const current = await this.command(CLASSIC_ROUTES.getControlInfo);
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

  // --- extended controls ---------------------------------------------------
  // Each maps to its own endpoint (not control_info).

  /** Adapter status LED on/off (`set_led`). */
  async setLed(on: boolean): Promise<void> {
    await this.command(CLASSIC_ROUTES.setLed, encodeClassicLed(on));
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

  /** Powerful, econo or streamer (`set_special_mode`). */
  async setSpecialMode(mode: SpecialMode, enabled: boolean): Promise<void> {
    await this.command(
      CLASSIC_ROUTES.setSpecialMode,
      encodeClassicSpecialMode(mode, enabled),
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
    const fields = parseClassicKeyValue(
      await (retry ? withRetry(send, this.retryOptions) : send()),
    );
    assertClassicOk(fields);
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
