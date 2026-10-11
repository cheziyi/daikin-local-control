import type { DaikinCapabilities } from "../models/capabilities.js";
import type {
  DaikinControl,
  DaikinSensors,
  DaikinState,
} from "../models/state.js";

/** The controls every adapter offers, whatever its wire protocol or
 * authentication. `createDaikinClient` picks the implementation, so a caller
 * needs the concrete class only for what one protocol adds, such as
 * `ClassicDaikinClient.registerTerminal`. Every method rejects with a
 * `DaikinError` when its request fails. */
export interface DaikinClient {
  /** The unit's supported features. */
  getCapabilities(): Promise<DaikinCapabilities>;

  /** Current controllable state. */
  getState(): Promise<DaikinState>;

  /** Change part of the state. The client reads the current state, overlays the
   * control, and writes the whole thing back. */
  setState(control: DaikinControl): Promise<void>;

  /** Read-only temperature / humidity readings. */
  getSensors(): Promise<DaikinSensors>;

  /** Close the connection to the adapter. */
  close(): Promise<void>;
}
