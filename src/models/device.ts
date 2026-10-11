export const DAIKIN_PROTOCOLS = ["classic", "dsiot"] as const;

/** The wire protocol an adapter speaks, and the only difference between
 * adapters that takes a separate `DaikinClient` implementation: `classic` for
 * a CGI adapter such as the BRP069 or BRP072, `dsiot` for a BRP084. */
export type DaikinProtocol = (typeof DAIKIN_PROTOCOLS)[number];

/** An adapter on the LAN, as `discoverDevices` finds it or as a caller writes
 * it by hand, carrying what `createDaikinClient` needs to reach it. A flag left
 * out means `false`, so a device written by hand needs only `host` and
 * `protocol`. */
export interface DaikinDevice {
  /** Address, with `:port` when the adapter announces one. */
  host: string;
  protocol: DaikinProtocol;
  name?: string;
  /** The adapter answers a terminal uuid only once it is registered with the
   * KEY on the adapter's label (`registerTerminal`). Classic only. */
  requiresRegistration?: boolean;
  /** The adapter speaks HTTPS. An adapter can require registration and still
   * speak plain HTTP. */
  usesHttps?: boolean;
  /** The adapter requires the local password: the child lock code. */
  requiresLocalPassword?: boolean;
}
