import type {
  DemandControl,
  DemandMode,
  DeviceGroup,
  SpecialMode,
  TerminalScope,
} from "../../models/extendedControl.js";

// Encodes each control outside `control_info` as the query its classic `set_*`
// endpoint takes.

const TERMINAL_SCOPE_CODES: Record<TerminalScope, string> = {
  self: "0",
  others: "1",
  all: "2",
};

const DEMAND_MODE_CODES: Record<DemandMode, string> = {
  manual: "0",
  auto: "2",
};

// `spmode_kind` on the wire; control_info's `adv` reports powerful as 2 and
// econo as 12.
const SPECIAL_MODE_KIND_CODES: Record<
  Exclude<SpecialMode, "streamer">,
  string
> = {
  powerful: "1",
  econo: "2",
};

// `method`: the adapter is reached from outside the home network while it
// polls, and from inside only otherwise.
const REMOTE_METHOD_POLLING = "polling";
const REMOTE_METHOD_HOME_ONLY = "home only";

const REMOTE_METHOD_INTERVALS = ["notice_ip_int", "notice_sync_int"];

export function encodeClassicLed(on: boolean): Record<string, string> {
  return { led: flag(on) };
}

export function encodeClassicHolidayMode(
  enabled: boolean,
): Record<string, string> {
  return { en_hol: flag(enabled) };
}

export function encodeClassicDemandControl(
  demand: DemandControl,
): Record<string, string> {
  return {
    demand_type: "1",
    en_demand: flag(demand.enabled),
    mode: DEMAND_MODE_CODES[demand.mode],
    max_pow: String(demand.maxPowerInPercent),
  };
}

export function encodeClassicSpecialMode(
  mode: SpecialMode,
  enabled: boolean,
): Record<string, string> {
  return mode === "streamer"
    ? { en_streamer: flag(enabled) }
    : { set_spmode: flag(enabled), spmode_kind: SPECIAL_MODE_KIND_CODES[mode] };
}

/** Turns `current`, the `get_remote_method` reply, and `enabled` into the
 * `set_remote_method` query. The endpoint takes the intervals back unchanged,
 * so the reply's `notice_ip_int` and `notice_sync_int` are copied in. */
export function applyClassicOutOfHomeAccess(
  current: Record<string, string>,
  enabled: boolean,
): Record<string, string> {
  const query: Record<string, string> = {
    method: enabled ? REMOTE_METHOD_POLLING : REMOTE_METHOD_HOME_ONLY,
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
 * (`price_int`) and hundredths (`price_dec`). The price is rounded to two
 * decimal places. */
export function encodeClassicEnergyPrice(
  price: number,
): Record<string, string> {
  const hundredths = Math.round(price * 100);
  return {
    price_int: String(Math.trunc(hundredths / 100)),
    price_dec: String(hundredths % 100),
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

export function encodeClassicTerminalKey(key: string): Record<string, string> {
  return { key };
}

export function encodeClassicTerminalScope(
  scope: TerminalScope,
): Record<string, string> {
  return { type: TERMINAL_SCOPE_CODES[scope] };
}

function flag(on: boolean): string {
  return on ? "1" : "0";
}
