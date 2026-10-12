// Inputs to the controls outside `DaikinState`, which only a classic adapter
// takes.

export const TERMINAL_SCOPES = ["self", "others", "all"] as const;

/** Which registered terminals to unregister: this uuid, every other uuid, or
 * all of them. */
export type TerminalScope = (typeof TERMINAL_SCOPES)[number];

/** The adapter's third mode, schedule, is not offered: see UNSUPPORTED.md. */
export const DEMAND_MODES = ["manual", "auto"] as const;

/** Who picks the cap: `manual` holds the unit to `maxPowerInPercent`, and `auto`
 * lets the unit choose, which it does in cool and heat only. */
export type DemandMode = (typeof DEMAND_MODES)[number];

export interface DemandControl {
  enabled: boolean;
  /** The unit caps its power draw at this percent. A unit accepts 40, 50 and
   * 70 in `manual` and 85 in `auto`; what else it accepts is not known. */
  maxPowerInPercent: number;
  mode: DemandMode;
}

export interface DeviceGroup {
  name: string;
  /** Whether the unit is in the group. */
  enabled: boolean;
}

/** `setMetadata` writes no field that is left out, and `getMetadata` leaves
 * out a field the adapter does not report. */
export interface DeviceMetadata {
  name?: string;
  /** The adapter's own code for the icon: see UNSUPPORTED.md. */
  icon?: string;
  group?: DeviceGroup;
}
