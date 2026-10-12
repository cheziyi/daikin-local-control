import type { DaikinDevice, DaikinDeviceInfo } from "../models/device.js";
import { decodeClassicText } from "./classic/keyValue.js";

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
    name:
      basicInfo.name === undefined
        ? undefined
        : decodeClassicText(basicInfo.name),
    // Only classic adapters register terminals.
    requiresRegistration: secure && protocol === "classic",
    // Only a Marvell adapter (adp_kind=3) in secure mode speaks HTTPS; every
    // other adapter, DSIOT included, stays on HTTP on the LAN.
    usesHttps:
      secure &&
      protocol === "classic" &&
      basicInfo.adp_kind === MARVELL_ADP_KIND,
    requiresLocalPassword: basicInfo.lpw_flag === "1",
    ...parseDeviceInfo(basicInfo),
  };
}

/** Reads what a `basic_info` reply says to identify the adapter. */
export function parseDeviceInfo(
  basicInfo: Record<string, string>,
): DaikinDeviceInfo {
  return {
    macAddress: decodeMacAddress(basicInfo.mac),
    firmwareVersion: decodeFirmwareVersion(basicInfo.ver),
  };
}

/** The adapter sends a MAC address without separators. It keeps the adapter's
 * letter case. */
export function decodeMacAddress(
  value: string | undefined,
): string | undefined {
  return value ? value.replace(/..(?=..)/g, "$&:") : undefined;
}

/** The adapter sends a version as three numbers joined by underscores, with a
 * fourth part, `pre`, on a pre-release. This drops any other fourth part, and
 * decodes a value that is not three numbers to `undefined`. */
export function decodeFirmwareVersion(
  value: string | undefined,
): string | undefined {
  const parts = /^(\d+)_(\d+)_(\d+)(?:_([^_]*))?$/.exec(value ?? "");
  if (parts === null) {
    return undefined;
  }
  const version = parts.slice(1, 4).map(Number).join(".");
  return parts[4] === "pre" ? `${version}.pre` : version;
}
