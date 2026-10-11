import {
  encodeClassicLocalPassword,
  encodeDsiotLocalPassword,
} from "./codecs/credentials.js";

// Authentication is orthogonal to the wire protocol, so it is injected rather
// than subclassed. A strategy contributes both headers and query, because the
// classic protocol carries its local password as a query parameter while
// DSIOT carries it as a Basic header.
//
// An adapter without a local password (basic_info `lpw_flag=0`) takes no
// strategy: the uuid header alone is accepted. `en_secure` is not
// authentication here: it means the terminal uuid must be registered
// (`registerTerminal`), plus HTTPS on a Marvell adapter, which is the
// transport's scheme.

/** `DaikinTransport.send` calls both methods on every request and adds what
 * they return. */
export interface DaikinAuthentication {
  headers(): Record<string, string> | Promise<Record<string, string>>;
  /** Replaces a request parameter of the same name. */
  query(): Record<string, string> | Promise<Record<string, string>>;
}

/** Classic adapter that requires the local password: sent as
 * `?lpw=<value>`. */
export class ClassicLocalPasswordAuthentication
  implements DaikinAuthentication
{
  constructor(private readonly localPassword: string) {}

  headers(): Record<string, string> {
    return {};
  }

  query(): Record<string, string> {
    return encodeClassicLocalPassword(this.localPassword);
  }
}

/** DSIOT adapter that requires the local password: sent as
 * `Authorization: Basic <lpw>`. */
export class DsiotLocalPasswordAuthentication implements DaikinAuthentication {
  constructor(private readonly localPassword: string) {}

  headers(): Record<string, string> {
    return encodeDsiotLocalPassword(this.localPassword);
  }

  query(): Record<string, string> {
    return {};
  }
}
