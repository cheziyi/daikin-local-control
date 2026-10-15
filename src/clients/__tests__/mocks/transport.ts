import type { DaikinRequest, DaikinTransport } from "../../../transport.js";

export type MockReply = (request: DaikinRequest) => string | Promise<string>;

/** Answers each request with `reply`, which may throw, and records what was
 * sent. */
export class MockDaikinTransport
  implements Pick<DaikinTransport, "send" | "dispose">
{
  readonly sent: DaikinRequest[] = [];
  disposed = false;

  constructor(private readonly reply: MockReply) {}

  async send(request: DaikinRequest): Promise<string> {
    this.sent.push(request);
    return this.reply(request);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  // DaikinTransport has private fields, so no mock is structurally assignable
  // to it.
  asTransport(): DaikinTransport {
    return this as unknown as DaikinTransport;
  }
}

/** Throws `error` for the first `failures` requests, then answers with
 * `reply`. */
export function failingFirst(
  failures: number,
  error: Error,
  reply: MockReply,
): MockReply {
  let remaining = failures;
  return (request) => {
    if (remaining > 0) {
      remaining -= 1;
      throw error;
    }
    return reply(request);
  };
}
