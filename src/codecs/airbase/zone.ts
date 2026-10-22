import type { DaikinZone } from "../../models/zone.js";
import { decodeClassicText } from "../classic/keyValue.js";
import {
  parseAirbaseZoneCount,
  setsAirbaseZoneTemperatures,
} from "./capabilities.js";
import {
  AIRBASE_OPERATING_MODE_CODES,
  AIRBASE_ZONE_LIST_SEPARATOR,
  AIRBASE_ZONE_TEMPERATURE_FIELDS,
} from "./tables.js";

// `get_zone_setting` answers the zones as lists, form-encoded: their names in
// `zone_name`, and 1 or 0 for each in `zone_onoff`. A unit that sets a
// temperature for each zone answers the two temperature lists as well, and
// takes the running mode's back with a write.

function decodeList(value: string | undefined): string[] {
  return value === undefined || value === ""
    ? []
    : decodeClassicText(value).split(AIRBASE_ZONE_LIST_SEPARATOR);
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
 * goes back as the unit holds it. On a unit that sets a temperature for each
 * zone (`setsAirbaseZoneTemperatures`), the temperatures of the mode
 * `controlInfo`, the `get_control_info` reply, says it runs in go back as
 * well: `lztemp_c` in cool, `lztemp_h` in heat, the one `bk_auto` names in
 * auto, and neither in fan and dehumidify. It throws an `Error` for an index
 * the unit has no zone at. */
export function applyAirbaseZone(
  current: Record<string, string>,
  capabilityFields: Record<string, string>,
  controlInfo: Record<string, string>,
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
    zone_name: decodeList(current.zone_name).join(AIRBASE_ZONE_LIST_SEPARATOR),
    zone_onoff: flags.join(AIRBASE_ZONE_LIST_SEPARATOR),
  };
  const field = setsAirbaseZoneTemperatures(capabilityFields)
    ? zoneTemperatureField(controlInfo)
    : undefined;
  const value = field === undefined ? undefined : current[field];
  if (field !== undefined && value !== undefined) {
    query[field] = decodeClassicText(value);
  }
  return query;
}

function zoneTemperatureField(
  controlInfo: Record<string, string>,
): string | undefined {
  const { cool, heat, auto } = AIRBASE_OPERATING_MODE_CODES;
  const mode = controlInfo.mode;
  const runsOn =
    mode === auto ? (controlInfo.bk_auto === heat ? heat : cool) : mode;
  if (runsOn === cool) {
    return AIRBASE_ZONE_TEMPERATURE_FIELDS.cool;
  }
  return runsOn === heat ? AIRBASE_ZONE_TEMPERATURE_FIELDS.heat : undefined;
}
