/** Caches the reply a client last read a unit's state from, for `setState`
 * alone. A write carries more than the fields a control changes, so
 * `setState` builds it from what the unit holds: from this reply while it is
 * fresh, and from a read of its own otherwise. No read is answered from the
 * cache: see DESIGN.md#the-read-before-a-write. */
export class SetStateCache {
  private kept:
    | { reply: Record<string, string>; readAtInMs: number }
    | undefined;

  /** `get` answers a reply younger than `maxAgeInMs`, so 0 answers none. */
  constructor(private readonly maxAgeInMs: number) {}

  set(reply: Record<string, string>): void {
    this.kept = { reply, readAtInMs: performance.now() };
  }

  get(): Record<string, string> | undefined {
    return this.kept !== undefined &&
      performance.now() - this.kept.readAtInMs < this.maxAgeInMs
      ? this.kept.reply
      : undefined;
  }

  clear(): void {
    this.kept = undefined;
  }
}
