import { z } from 'zod';
import { localPanelUpdate, type LocalPanelUpdate } from './panel_update';

/** Largest JSON text fragment carried in a single command frame. */
export const PANEL_CHUNK_UNITS = 16_384;
/** Maximum fragments retained for one visible update. */
export const MAX_PANEL_CHUNKS = 1024;

/** Validates one bounded fragment of a visible workspace panel update. */
export const localPanelChunk = z
  .strictObject({
    pageEpoch: z.int().positive(),
    messageId: z.int().positive(),
    index: z
      .int()
      .nonnegative()
      .max(MAX_PANEL_CHUNKS - 1),
    count: z.int().positive().max(MAX_PANEL_CHUNKS),
    data: z.string().min(1).max(PANEL_CHUNK_UNITS),
  })
  .refine((chunk) => chunk.index < chunk.count);

/** A validated fragment before the connection envelope is added. */
export type LocalPanelChunk = z.infer<typeof localPanelChunk>;

/** Splits one validated visible update into bounded ordered fragments. */
export function splitPanelUpdate(value: unknown, identity: { pageEpoch: number; messageId: number }): LocalPanelChunk[] {
  const update = localPanelUpdate.parse(value);
  const data = JSON.stringify(update);
  const count = Math.ceil(data.length / PANEL_CHUNK_UNITS);
  if (count > MAX_PANEL_CHUNKS) throw new Error('Panel update exceeds the transfer limit.');
  const chunks: LocalPanelChunk[] = [];
  for (let index = 0; index < count; index++) {
    chunks.push(
      localPanelChunk.parse({ ...identity, index, count, data: data.slice(index * PANEL_CHUNK_UNITS, (index + 1) * PANEL_CHUNK_UNITS) }),
    );
  }
  return chunks;
}

/** Reassembles one ordered update for the current local page. */
export class PanelChunkAssembler {
  private page?: number;
  private lastMessage = 0;
  private pending?: { messageId: number; count: number; parts: string[] };

  /** Replaces the page and drops any incomplete update. */
  setPage(page: number | undefined): void {
    this.page = page;
    this.pending = undefined;
  }

  /** Returns a validated update only when every ordered fragment is present. */
  accept(value: unknown): LocalPanelUpdate | undefined {
    const parsed = localPanelChunk.safeParse(value);
    if (!parsed.success) {
      this.pending = undefined;
      return undefined;
    }
    const chunk = parsed.data;
    if (chunk.pageEpoch !== this.page) return undefined;
    // specs/LocalPanelReplay.tla, Receive: only a fresh message may start an ordered assembly.
    if (this.pending === undefined || this.pending.messageId !== chunk.messageId) {
      if (chunk.messageId <= this.lastMessage) return undefined;
      this.lastMessage = chunk.messageId;
      this.pending = undefined;
      if (chunk.index !== 0) return undefined;
      this.pending = { messageId: chunk.messageId, count: chunk.count, parts: [] };
    }
    const pending = this.pending;
    if (chunk.count !== pending.count || chunk.index !== pending.parts.length) {
      this.pending = undefined;
      return undefined;
    }
    pending.parts.push(chunk.data);
    if (pending.parts.length !== pending.count) return undefined;
    this.pending = undefined;
    try {
      const decoded: unknown = JSON.parse(pending.parts.join(''));
      const update = localPanelUpdate.safeParse(decoded);
      return update.success ? update.data : undefined;
    } catch {
      return undefined;
    }
  }
}
