/** One zone of a ducted unit on an Airbase adapter: a damper that opens or
 * closes the air to part of the building. */
export interface DaikinZone {
  /** The name the zone was given, without the spaces around it. */
  name: string;
  /** Whether the zone is open. */
  enabled: boolean;
}
