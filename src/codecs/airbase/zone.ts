import type { DaikinZone } from "../../models/zone.js";
import { decodeClassicText } from "../classic/keyValue.js";
import { parseAirbaseZoneCount } from "./capabilities.js";

// `get_zone_setting` answers the zones as lists joined by `;`, form-encoded:
// their names in `zone_name`, and 1 or 0 for each in `zone_onoff`.
const SEPARATOR = ";";
// A unit that sets a temperature for each zone answers these two as well, and
// takes them back with every write.
const ZONE_TEMPERATURE_FIELDS = ["lztemp_c", "lztemp_h"];

function decodeList(value: string | undefined): string[] {
  return value === undefined || value === ""
    ? []
    : decodeClassicText(value).split(SEPARATOR);
}

/** Turns a `get_zone_setting` reply into the unit's zones, the first
 * `en_zone` of them. `capabilityFields` is the field map of
 * `mergeAirbaseCapabilityFields`. */
export function parseAirbaseZones(
  zoneSetting: Record<string, string>,
  capabilityFields: Record<string, string>,
): DaikinZone[] {
  const flags = decodeList(zoneSetting.zone_onoff);
  return decodeList(zoneSetting.zone_name)
    .slice(0, parseAirbaseZoneCount(capabilityFields))
    .map((name, index) => ({
      name: name.trim(),
      enabled: flags[index] === "1",
    }));
}

/** Turns `current`, the `get_zone_setting` reply, into the `set_zone_setting`
 * query that opens or closes the zone at `index`, counted from 0. Every name
 * goes back as the unit holds it, with each zone's temperatures where the
 * unit has them. It throws an `Error` for an index the unit has no zone
 * at. */
export function applyAirbaseZone(
  current: Record<string, string>,
  capabilityFields: Record<string, string>,
  index: number,
  enabled: boolean,
): Record<string, string> {
  const zoneCount = parseAirbaseZones(current, capabilityFields).length;
  if (!Number.isInteger(index) || index < 0 || index >= zoneCount) {
    throw new Error(`The unit has no zone ${index}: it has ${zoneCount}`);
  }
  const flags = decodeList(current.zone_onoff);
  flags[index] = enabled ? "1" : "0";
  const query: Record<string, string> = {
    zone_name: decodeList(current.zone_name).join(SEPARATOR),
    zone_onoff: flags.join(SEPARATOR),
  };
  for (const field of ZONE_TEMPERATURE_FIELDS) {
    const value = current[field];
    if (value !== undefined) {
      query[field] = decodeClassicText(value);
    }
  }
  return query;
}
