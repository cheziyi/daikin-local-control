import type { DaikinDeviceInfo } from "../../models/device.js";
import { decodeFirmwareVersion, decodeMacAddress } from "../device.js";

const ADAPTER_PATHS = {
  macAddress: "adp_i.mac",
  firmwareVersion: "adp_i.ver",
} as const;

/** Reads what the flattened `adp_i` tree says to identify the adapter. Both
 * leaves hold the value a classic adapter sends in `basic_info`. */
export function parseDsiotDeviceInfo(
  values: Record<string, string>,
): DaikinDeviceInfo {
  return {
    macAddress: decodeMacAddress(values[ADAPTER_PATHS.macAddress]),
    firmwareVersion: decodeFirmwareVersion(
      values[ADAPTER_PATHS.firmwareVersion],
    ),
  };
}
