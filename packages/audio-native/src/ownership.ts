import { randomUUID } from 'node:crypto';
import type { AudioLease, AudioOwner } from './index';

/** Keeps physical ownership until the process for the exact lease retires. */
export class Ownership {
  private current?: { lease: AudioLease; owner: AudioOwner };

  reserve(owner: AudioOwner): AudioLease | undefined {
    if (this.current) return undefined;
    // A fresh unguessable value is the only source of branded leases.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const lease = randomUUID() as AudioLease;
    this.current = { lease, owner: { ...owner } };
    return lease;
  }

  hasLease(lease: AudioLease | undefined): boolean {
    return lease !== undefined && this.current?.lease === lease;
  }

  matches(owner: AudioOwner): boolean {
    const current = this.current?.owner;
    return (
      !!current &&
      current.connectionEpoch === owner.connectionEpoch &&
      current.jobId === owner.jobId &&
      current.pageEpoch === owner.pageEpoch
    );
  }

  retire(lease: AudioLease | undefined, owner: AudioOwner): boolean {
    if (!this.hasLease(lease) || !this.matches(owner)) return false;
    this.current = undefined;
    return true;
  }
}
