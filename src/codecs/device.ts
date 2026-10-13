import type { DaikinDevice, DaikinDeviceInfo } from "../models/device.js";
import { decodeClassicText } from "./classic/keyValue.js";
import { CLASSIC_ADAPTER_TYPE } from "./classic/tables.js";
import {
  DSIOT_ADAPTER_TYPE,
  DSIOT_AIR_CLEANER_DEVICES,
} from "./dsiot/tables.js";

const MARVELL_ADP_KIND = "3";

/** Whether a `basic_info` reply comes from the adapter of an air conditioner:
 * `type=aircon`, or `type=GPF` with a `cdev` that is not an air cleaner's. The
 * adapter of another appliance answers the discovery probe as well, such as
 * an air cleaner (`type=cleaner`) or a water heater (`type=Water Heater`). */
export function isAirConditioner(basicInfo: Record<string, string>): boolean {
  if (basicInfo.type === DSIOT_ADAPTER_TYPE) {
    return !DSIOT_AIR_CLEANER_DEVICES.includes(basicInfo.cdev ?? "");
  }
  return basicInfo.type === CLASSIC_ADAPTER_TYPE;
}

/** Turns a `basic_info` reply into a `DaikinDevice`: `type=GPF` marks a DSIOT
 * adapter, and `api_port`, when present, is the HTTP port and is appended to
 * `host`, the address the reply came from. It reads any reply as an air
 * conditioner's: check the reply with `isAirConditioner` first. */
export function parseDevice(
  host: string,
  basicInfo: Record<string, string>,
): DaikinDevice {
  const protocol = basicInfo.type === DSIOT_ADAPTER_TYPE ? "dsiot" : "classic";
  const secure = basicInfo.en_secure === "1";
  return {
    host: basicInfo.api_port ? `${host}:${basicInfo.api_port}` : host,
    protocol,
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

/** Reads what a `basic_info` reply says to identify the adapter. The name
 * arrives form-encoded. */
export function parseDeviceInfo(
  basicInfo: Record<string, string>,
): DaikinDeviceInfo {
  return {
    name:
      basicInfo.name === undefined
        ? undefined
        : decodeClassicText(basicInfo.name),
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
