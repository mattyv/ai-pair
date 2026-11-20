import { z } from 'zod';
import { WORKER_ACK_SCHEMA, WORKER_GRANT_SCHEMA, WORKER_TEXT_LIMIT } from '@ai-pair/protocol';
import type { EditorLink } from './link';

/** A JSON code-unit escape takes six bytes. Leave room for the Codex event envelope. */
const JSON_ESCAPE_BYTES = 6;
const ENVELOPE_BYTES = 1024;
const MAX_LINE_BYTES = JSON_ESCAPE_BYTES * WORKER_TEXT_LIMIT + ENVELOPE_BYTES;
const LINE_FEED = 0x0a;

/** A generic error for the owner and the launcher. */
export const WORKER_TRANSCRIPT_FAILURE = 'Codex worker transcript failed.';

/** Validates the fields needed to classify Codex records without reading other payloads. */
const CODEX_EVENT = z.object({ type: z.string().min(1), item: z.unknown().optional() });
const CODEX_ITEM = z.object({ type: z.string().min(1), text: z.unknown().optional() });
const CODEX_TEXT = z.string().max(WORKER_TEXT_LIMIT);
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The launcher's private grant and Codex stdout as a byte stream. */
export type WorkerTranscriptInput = AsyncIterable<Buffer> | Iterable<Buffer>;

/** Decodes a record only when its bytes fit the bound and form valid UTF-8. */
function decodeRecord(record: Buffer, size: number): string | undefined {
  if (size > MAX_LINE_BYTES) return undefined;
  try {
    return UTF8.decode(record.subarray(0, size));
  } catch {
    return undefined;
  }
}

/** Reads one bounded UTF-8 record at a time, yielding undefined for an unreadable record. */
async function* readLines(input: WorkerTranscriptInput): AsyncGenerator<string | undefined> {
  const record = Buffer.alloc(MAX_LINE_BYTES);
  let size = 0;
  for await (const chunk of input) {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(LINE_FEED, offset);
      const end = newline === -1 ? chunk.length : newline;
      if (size + end - offset <= MAX_LINE_BYTES) {
        chunk.copy(record, size, offset, end);
        size += end - offset;
      } else {
        size = MAX_LINE_BYTES + 1;
      }
      if (newline === -1) break;
      yield decodeRecord(record, size);
      size = 0;
      offset = newline + 1;
    }
  }
  if (size > 0) yield decodeRecord(record, size);
}

/** Parses a single NDJSON record without exposing invalid input. */
function parseRecord(line: string | undefined): unknown {
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Forwards completed Codex messages to the exact editor grant on the private first line. */
export async function forwardCodexWorkerTranscript(input: WorkerTranscriptInput, link: Pick<EditorLink, 'callWorker'>): Promise<boolean> {
  let grant: z.infer<typeof WORKER_GRANT_SCHEMA> | undefined;
  let completed = false;
  let failed = false;
  try {
    for await (const line of readLines(input)) {
      const parsed = parseRecord(line);
      if (grant === undefined) {
        grant = WORKER_GRANT_SCHEMA.parse(parsed);
        continue;
      }
      if (line?.trim() === '') continue;
      const event = CODEX_EVENT.safeParse(parsed);
      if (!event.success || event.data.type === 'turn.failed') {
        failed = true;
      } else if (event.data.type === 'turn.completed') {
        completed = true;
      } else if (event.data.type === 'item.completed') {
        const item = CODEX_ITEM.safeParse(event.data.item);
        if (!item.success) {
          failed = true;
          continue;
        }
        if (item.data.type !== 'agent_message') continue;
        const text = CODEX_TEXT.safeParse(item.data.text);
        if (!text.success) {
          failed = true;
          continue;
        }
        if (text.data === '') continue;
        // specs/WorkerOutput.tla, Output: forward one bounded message over the exact grant.
        WORKER_ACK_SCHEMA.parse(await link.callWorker(grant.port, 'worker_output', { capability: grant.capability, text: text.data }));
      }
    }
  } catch {
    failed = true;
  }
  if (grant === undefined) return false;

  // The adapter owns completion after grant acceptance. Await EOF and each output acknowledgement first.
  const succeeded = completed && !failed;
  try {
    const text = succeeded ? 'Codex worker finished.' : WORKER_TRANSCRIPT_FAILURE;
    WORKER_ACK_SCHEMA.parse(await link.callWorker(grant.port, 'worker_done', { capability: grant.capability, text }));
  } catch {
    return false;
  }
  return succeeded;
}
