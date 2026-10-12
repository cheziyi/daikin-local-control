import { DaikinError } from "../../error.js";

// The classic CGI protocol answers a flat, comma-separated `key=value` string,
// e.g. `ret=OK,pow=1,mode=3,stemp=24,...`, and takes its writes as query parameters.

/** Splits a classic reply into its fields. A pair without `=` is dropped, and
 * a value is kept as the adapter sent it, undecoded. */
export function parseClassicKeyValue(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of body.split(",")) {
    const index = pair.indexOf("=");
    if (index === -1) {
      continue;
    }
    result[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return result;
}

/** Decodes a form-encoded value, such as a name: `+` is a space. A value that
 * is not valid percent-encoding is returned as the adapter sent it. */
export function decodeClassicText(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
}

export function isClassicOk(fields: Record<string, string>): boolean {
  return fields.ret === "OK";
}

/** Throws a `DaikinError` unless the reply's `ret` is `OK`: status 401 for
 * `AUTH NG` or `LPW NG`, 502 for anything else. Every reply carries a `ret`,
 * and the adapter rejects a call with HTTP 200, so the rejection has to be
 * read here rather than from the status code. */
export function assertClassicOk(fields: Record<string, string>): void {
  if (isClassicOk(fields)) {
    return;
  }
  const ret = fields.ret;
  // AUTH NG: the terminal is not registered. LPW NG: the child lock code is
  // wrong.
  if (ret === "AUTH NG" || ret === "LPW NG") {
    throw new DaikinError(`Daikin rejected the credentials (ret=${ret})`, 401);
  }
  throw new DaikinError(`Daikin command failed (ret=${ret ?? "missing"})`, 502);
}
