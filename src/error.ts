export class DaikinError extends Error {
  constructor(
    message: string,
    /** The adapter's own HTTP status, or the status this package gives a
     * failure that has none: the README's "Errors and retries" lists them. */
    readonly httpStatusCode: number,
  ) {
    super(message);
    this.name = "DaikinError";
  }
}

/** The adapter refused or dropped the connection before answering. The only
 * failure `withRetry` repeats: see DESIGN.md#retries. */
export class DaikinConnectionError extends DaikinError {
  constructor(message: string) {
    super(message, 503);
    this.name = "DaikinConnectionError";
  }
}
