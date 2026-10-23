import type {
  DemandControl,
  DemandMode,
  DeviceGroup,
  DeviceMetadata,
  TerminalScope,
} from "../../models/extendedControl.js";
import type { SpecialMode } from "../../models/state.js";
import { decodeClassicText } from "./keyValue.js";
import {
  CLASSIC_DEMAND_MODE_CODES,
  CLASSIC_REMOTE_METHODS,
  CLASSIC_SPECIAL_MODE_KIND_CODES,
  CLASSIC_TERMINAL_SCOPE_CODES,
} from "./tables.js";

// Encodes each control outside `DaikinState` as the query its classic `set_*`
// endpoint takes, and reads each one back from the reply that reports it.

const REMOTE_METHOD_INTERVALS = ["notice_ip_int", "notice_sync_int"];

const DEMAND_MODES_BY_CODE: Record<string, DemandMode> = Object.fromEntries(
  Object.entries(CLASSIC_DEMAND_MODE_CODES).map(([mode, code]) => [
    code,
    mode as DemandMode,
  ]),
);

export function encodeClassicLed(on: boolean): Record<string, string> {
  return { led: flag(on) };
}

/** Reads the LED from a `basic_info` reply: `null` when it carries no `led`. */
export function parseClassicLed(
  fields: Record<string, string>,
): boolean | null {
  return parseFlag(fields.led);
}

export function encodeClassicHolidayMode(
  enabled: boolean,
): Record<string, string> {
  return { en_hol: flag(enabled) };
}

/** Reads holiday mode from a `basic_info` reply: `null` when it carries no
 * `en_hol`. */
export function parseClassicHolidayMode(
  fields: Record<string, string>,
): boolean | null {
  return parseFlag(fields.en_hol);
}

export function encodeClassicDemandControl(
  demand: DemandControl,
): Record<string, string> {
  return {
    demand_type: "1",
    en_demand: flag(demand.enabled),
    mode: CLASSIC_DEMAND_MODE_CODES[demand.mode],
    max_pow: String(demand.maxPowerInPercent),
  };
}

/** Reads demand control from a `get_demand_control` reply: `null` when it
 * carries no `en_demand` or `max_pow`, or a `mode` outside `DemandMode`, such
 * as the schedule mode. */
export function parseClassicDemandControl(
  fields: Record<string, string>,
): DemandControl | null {
  const mode = DEMAND_MODES_BY_CODE[fields.mode ?? ""];
  const maxPowerInPercent = parseNumber(fields.max_pow);
  if (fields.en_demand === undefined || mode === undefined) {
    return null;
  }
  return maxPowerInPercent === null
    ? null
    : { enabled: fields.en_demand === "1", maxPowerInPercent, mode };
}

/** Reads the price from a `get_price` reply, whole units in `price_int` and
 * hundredths in `price_dec`: `null` when it lacks either. */
export function parseClassicEnergyPrice(
  fields: Record<string, string>,
): number | null {
  const whole = parseNumber(fields.price_int);
  const hundredths = parseNumber(fields.price_dec);
  return whole === null || hundredths === null
    ? null
    : whole + hundredths / 100;
}

/** Reads the target from a `get_target` reply: `null` when it carries no
 * `target`. */
export function parseClassicEnergyTarget(
  fields: Record<string, string>,
): number | null {
  return parseNumber(fields.target);
}

export function encodeClassicSpecialMode(
  mode: SpecialMode,
  enabled: boolean,
): Record<string, string> {
  return mode === "streamer"
    ? { en_streamer: flag(enabled) }
    : {
        set_spmode: flag(enabled),
        spmode_kind: CLASSIC_SPECIAL_MODE_KIND_CODES[mode],
      };
}

/** Reads out-of-home access from a `basic_info` reply: `null` when it carries
 * no `method`. */
export function parseClassicOutOfHomeAccess(
  fields: Record<string, string>,
): boolean | null {
  return fields.method === undefined
    ? null
    : fields.method === CLASSIC_REMOTE_METHODS.polling;
}

/** Turns `current`, the `get_remote_method` reply, and `enabled` into the
 * `set_remote_method` query. The endpoint takes the intervals back unchanged,
 * so the reply's `notice_ip_int` and `notice_sync_int` are copied in. */
export function applyClassicOutOfHomeAccess(
  current: Record<string, string>,
  enabled: boolean,
): Record<string, string> {
  const query: Record<string, string> = {
    method: enabled
      ? CLASSIC_REMOTE_METHODS.polling
      : CLASSIC_REMOTE_METHODS.homeOnly,
  };
  for (const key of REMOTE_METHOD_INTERVALS) {
    const value = current[key];
    if (value !== undefined) {
      query[key] = value;
    }
  }
  return query;
}

/** Encodes the price as the `set_price` query takes it: whole units
 * (`price_int`) and hundredths (`price_dec`), the latter as two digits. The
 * price is rounded to two decimal places. */
export function encodeClassicEnergyPrice(
  price: number,
): Record<string, string> {
  const hundredths = Math.round(price * 100);
  return {
    price_int: String(Math.trunc(hundredths / 100)),
    price_dec: String(hundredths % 100).padStart(2, "0"),
  };
}

export function encodeClassicEnergyTarget(
  target: number,
): Record<string, string> {
  return { target: String(target) };
}

export function encodeClassicName(name: string): Record<string, string> {
  return { name };
}

export function encodeClassicIcon(icon: string): Record<string, string> {
  return { icon };
}

export function encodeClassicGroup(group: DeviceGroup): Record<string, string> {
  return { grp_name: group.name, en_grp: flag(group.enabled) };
}

/** Reads the name, icon and group from a `basic_info` reply, leaving out each
 * one the reply does not carry. The name and the group's name arrive
 * form-encoded. */
export function parseClassicMetadata(
  fields: Record<string, string>,
): DeviceMetadata {
  return {
    name:
      fields.name === undefined ? undefined : decodeClassicText(fields.name),
    icon: fields.icon,
    group:
      fields.en_grp === undefined
        ? undefined
        : {
            name: decodeClassicText(fields.grp_name ?? ""),
            enabled: fields.en_grp === "1",
          },
  };
}

export function encodeClassicTerminalKey(key: string): Record<string, string> {
  return { key };
}

export function encodeClassicTerminalScope(
  scope: TerminalScope,
): Record<string, string> {
  return { type: CLASSIC_TERMINAL_SCOPE_CODES[scope] };
}

function flag(on: boolean): string {
  return on ? "1" : "0";
}

function parseFlag(value: string | undefined): boolean | null {
  return value === undefined ? null : value === "1";
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
