import type { DaikinDeviceInfo } from "../../models/device.js";
import { decodeFirmwareVersion, decodeMacAddress } from "../device.js";
import { DSIOT_ADAPTER_PATHS } from "./tables.js";

/** Reads what the flattened `adp_i` and `adp_d` trees say to identify the
 * adapter. Both `adp_i` leaves hold the value a classic adapter sends in
 * `basic_info`. `adp_d.name` holds the name as plain text, where a classic
 * adapter form-encodes it. */
export function parseDsiotDeviceInfo(
  values: Record<string, string>,
): DaikinDeviceInfo {
  return {
    name: values[DSIOT_ADAPTER_PATHS.name],
    macAddress: decodeMacAddress(values[DSIOT_ADAPTER_PATHS.macAddress]),
    firmwareVersion: decodeFirmwareVersion(
      values[DSIOT_ADAPTER_PATHS.firmwareVersion],
    ),
  };
}
