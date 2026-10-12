import type { DaikinDeviceInfo } from "../../models/device.js";
import { decodeFirmwareVersion, decodeMacAddress } from "../device.js";

const ADAPTER_PATHS = {
  name: "adp_d.name",
  macAddress: "adp_i.mac",
  firmwareVersion: "adp_i.ver",
} as const;

/** Reads what the flattened `adp_i` and `adp_d` trees say to identify the
 * adapter. Both `adp_i` leaves hold the value a classic adapter sends in
 * `basic_info`. `adp_d.name` holds the name as plain text, where a classic
 * adapter form-encodes it. */
export function parseDsiotDeviceInfo(
  values: Record<string, string>,
): DaikinDeviceInfo {
  return {
    name: values[ADAPTER_PATHS.name],
    macAddress: decodeMacAddress(values[ADAPTER_PATHS.macAddress]),
    firmwareVersion: decodeFirmwareVersion(
      values[ADAPTER_PATHS.firmwareVersion],
    ),
  };
}
