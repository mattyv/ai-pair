/** The helper sends only fixed, privacy-safe events on its control pipe. */
export type HelperEventType = 'ready' | 'started' | 'paused' | 'resumed' | 'ended' | 'canceled' | 'failed' | 'retired';
export interface HelperEvent {
  version: 1;
  sequence: number;
  type: HelperEventType;
}

const EVENT_TYPES: readonly HelperEventType[] = ['ready', 'started', 'paused', 'resumed', 'ended', 'canceled', 'failed', 'retired'];
const EVENT_FIELDS = 3;
const NEWLINE = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEventType(value: unknown): value is HelperEventType {
  return EVENT_TYPES.some((type) => type === value);
}
const MAX_EVENT_BYTES = 4096;

/** Reject unexpected fields so untrusted helper output cannot become diagnostics. */
export function parseHelperEvent(line: string): HelperEvent | undefined {
  if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const record = value;
  if (
    Object.keys(record).length !== EVENT_FIELDS ||
    record.version !== 1 ||
    typeof record.sequence !== 'number' ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !isEventType(record.type)
  ) {
    return undefined;
  }
  return { version: 1, sequence: record.sequence, type: record.type };
}

/** Decodes bounded newline frames and fails closed on missing or repeated sequence numbers. */
export class HelperEventFrames {
  private pending = Buffer.alloc(0);
  private sequence = 0;
  private invalid = false;

  constructor(private readonly emit: (event: HelperEvent) => void) {}

  push(chunk: Uint8Array): boolean {
    if (this.invalid) return false;
    const input = Buffer.from(chunk);
    let start = 0;
    while (start < input.length) {
      const end = input.indexOf(NEWLINE, start);
      const part = input.subarray(start, end < 0 ? input.length : end);
      if (this.pending.length + part.length > MAX_EVENT_BYTES) return this.fail();
      this.pending = Buffer.concat([this.pending, part]);
      if (end < 0) break;
      let line: string;
      try {
        line = new TextDecoder('utf-8', { fatal: true }).decode(this.pending);
      } catch {
        return this.fail();
      }
      this.pending = Buffer.alloc(0);
      const event = parseHelperEvent(line);
      if (!event || event.sequence !== this.sequence) return this.fail();
      this.sequence += 1;
      this.emit(event);
      start = end + 1;
    }
    return true;
  }

  finish(): boolean {
    if (this.invalid || this.pending.length !== 0) return this.fail();
    return true;
  }

  private fail(): false {
    this.invalid = true;
    this.pending = Buffer.alloc(0);
    return false;
  }
}
