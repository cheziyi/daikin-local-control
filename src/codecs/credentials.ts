/** The header that carries the terminal uuid on every call. The adapter takes
 * the uuid without its dashes. */
export function encodeTerminalUuid(uuid: string): Record<string, string> {
  return { "X-Daikin-uuid": uuid.replaceAll("-", "") };
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
