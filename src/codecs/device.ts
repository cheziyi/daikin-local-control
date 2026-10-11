import type { DaikinDevice } from "../models/device.js";

const DSIOT_TYPE = "GPF";
const MARVELL_ADP_KIND = "3";

/** Turns a `basic_info` reply into a `DaikinDevice`: `type=GPF` marks a DSIOT
 * adapter, and `api_port`, when present, is the HTTP port and is appended to
 * `host`, the address the reply came from. */
export function parseDevice(
  host: string,
  basicInfo: Record<string, string>,
): DaikinDevice {
  const protocol = basicInfo.type === DSIOT_TYPE ? "dsiot" : "classic";
  const secure = basicInfo.en_secure === "1";
  return {
    host: basicInfo.api_port ? `${host}:${basicInfo.api_port}` : host,
    protocol,
    name: decodeName(basicInfo.name),
    // Only classic adapters register terminals.
    requiresRegistration: secure && protocol === "classic",
    // Only a Marvell adapter (adp_kind=3) in secure mode speaks HTTPS; every
    // other adapter, DSIOT included, stays on HTTP on the LAN.
    usesHttps:
      secure &&
      protocol === "classic" &&
      basicInfo.adp_kind === MARVELL_ADP_KIND,
    requiresLocalPassword: basicInfo.lpw_flag === "1",
  };
}

// The name is form-encoded: `+` is a space.
function decodeName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
}
