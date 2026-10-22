// What every adapter holds the same way, whatever its protocol. The codecs,
// `discoverDevices` and the simulators all read it from here: see
// DESIGN.md#simulators.

/** The UDP datagram an adapter answers with the fields of its `basic_info`,
 * sent to `DAIKIN_DISCOVERY_PORT`. */
export const DAIKIN_DISCOVERY_PROBE = "DAIKIN_UDP/common/basic_info";
export const DAIKIN_DISCOVERY_PORT = 30050;

/** The header that carries the terminal uuid. */
export const DAIKIN_TERMINAL_UUID_HEADER = "X-Daikin-uuid";
