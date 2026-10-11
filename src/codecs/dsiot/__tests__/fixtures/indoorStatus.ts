import { DSIOT_PATHS } from "../../state.js";

/** The full path of a per-mode leaf, such as `p_02`, the cool setpoint. */
export function modeLeaf(name: string): string {
  return `dgc_status.e_1002.e_3001.${name}`;
}

/** A louver leaf's `md.mx`: four bytes, little-endian, with bit n set for
 * each value n the unit takes. */
export function louverMask(...values: number[]): string {
  const mask = values.reduce((bits, value) => bits | (1 << value), 0);
  return (mask.toString(16).toUpperCase().padStart(8, "0").match(/../g) ?? [])
    .reverse()
    .join("");
}

/** The flattened indoor `dgc_status` tree of a unit that is off, in cool at
 * 24 °C on the auto fan speed, with the vertical louver swinging. It reports no
 * humidity leaves and no `md`. */
export const INDOOR_STATUS: Record<string, string> = {
  [DSIOT_PATHS.power]: "00",
  [DSIOT_PATHS.mode]: "0200",
  [modeLeaf("p_02")]: "3000",
  [modeLeaf("p_09")]: "0A00",
  [modeLeaf("p_05")]: "0F0000",
  [modeLeaf("p_06")]: "000000",
  [DSIOT_PATHS.indoorTemperature]: "1A",
  [DSIOT_PATHS.indoorHumidity]: "37",
};
