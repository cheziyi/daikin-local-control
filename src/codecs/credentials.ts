const TERMINAL_UUID_PATTERN = /^[0-9a-f]{32}$/;

/** The header that carries the terminal uuid on every call. It throws an
 * `Error` unless the uuid is 32 lowercase hexadecimal digits, a UUID without
 * its dashes: whether the adapter accepts any other form is not known. */
export function encodeTerminalUuid(uuid: string): Record<string, string> {
  if (!TERMINAL_UUID_PATTERN.test(uuid)) {
    throw new Error(
      "The terminal uuid must be 32 lowercase hexadecimal digits, without dashes",
    );
  }
  return { "X-Daikin-uuid": uuid };
}

/** The query parameter a classic adapter takes the local password as. */
export function encodeClassicLocalPassword(
  localPassword: string,
): Record<string, string> {
  return { lpw: localPassword };
}

/** The header a DSIOT adapter takes the local password as. */
export function encodeDsiotLocalPassword(
  localPassword: string,
): Record<string, string> {
  return { Authorization: `Basic ${localPassword}` };
}
