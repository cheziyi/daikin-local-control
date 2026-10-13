import type { DaikinCapabilities } from "../models/capabilities.js";
import type { DaikinDeviceInfo } from "../models/device.js";
import type {
  DaikinControl,
  DaikinSensors,
  DaikinState,
  DaikinStateAndSensors,
  SpecialMode,
} from "../models/state.js";

/** The controls every adapter offers, whatever its wire protocol or
 * authentication. `createDaikinClient` picks the implementation, so a caller
 * needs the concrete class only for what one protocol adds, such as
 * `ClassicDaikinClient.registerTerminal`. Every method rejects with a
 * `DaikinError` when its request fails. */
export interface DaikinClient {
  /** The adapter's name, MAC address and firmware version. */
  getDeviceInfo(): Promise<DaikinDeviceInfo>;

  /** The unit's supported features. */
  getCapabilities(): Promise<DaikinCapabilities>;

  /** Current controllable state. */
  getState(): Promise<DaikinState>;

  /** Change part of the state. The client reads the current state, overlays the
   * control, and writes the whole thing back. It skips the read when it holds
   * a reply to `getState` or `getStateAndSensors` younger than
   * `CreateDaikinClientOptions.maxStateAgeForSetStateInMs`. */
  setState(control: DaikinControl): Promise<void>;

  /** Turn powerful, econo or streamer on or off, with a request of its own.
   * `DaikinCapabilities.specialModes` lists the ones the unit takes in each
   * mode, and the client sends any other as given. */
  setSpecialMode(mode: SpecialMode, enabled: boolean): Promise<void>;

  /** Read-only temperature / humidity readings. */
  getSensors(): Promise<DaikinSensors>;

  /** What `getState` and `getSensors` resolve with, together. A DSIOT adapter
   * answers both in one request, where calling the two sends the same request
   * twice. A classic adapter takes one request for each. */
  getStateAndSensors(): Promise<DaikinStateAndSensors>;

  /** Close the connection to the adapter. */
  close(): Promise<void>;
}
