import type { AudioChoice, AudioDevice, AudioLease, AudioOwner } from './index';
import { Ownership } from './ownership';

interface Discovery {
  list(): Promise<AudioDevice[]>;
  defaultId?(): Promise<string | undefined>;
}

/** Validates and snapshots a route before provider dispatch. No stream is opened here. */
export class AudioAdmission {
  private readonly ownership = new Ownership();
  private pending?: { owner: AudioOwner; lease: AudioLease; route?: string };

  constructor(private readonly discovery: Discovery) {}

  async admit(owner: AudioOwner, choice: AudioChoice): Promise<AudioLease> {
    const savedOwner = { ...owner };
    const lease = this.ownership.reserve(savedOwner);
    if (!lease) throw new Error('Audio output is busy.');
    this.pending = { owner: savedOwner, lease };
    try {
      const id = choice.kind === 'device' ? choice.id : await this.discovery.defaultId?.();
      const devices = await this.discovery.list();
      if (id === undefined || id.length === 0 || !devices.some((device) => device.id === id) || this.pending?.lease !== lease) {
        throw new Error('Audio output is unavailable.');
      }
      this.pending.route = id;
      return lease;
    } catch {
      this.ownership.retire(lease, savedOwner);
      if (this.pending?.lease === lease) this.pending = undefined;
      throw new Error('Audio output is unavailable.');
    }
  }

  route(lease: AudioLease): string | undefined {
    return this.ownership.hasLease(lease) && this.pending?.lease === lease ? this.pending.route : undefined;
  }

  /** Revalidate the exact captured route just before asking the backend to open it. */
  async recheck(lease: AudioLease): Promise<string | undefined> {
    const route = this.route(lease);
    if (route === undefined) return undefined;
    try {
      const devices = await this.discovery.list();
      if (this.route(lease) !== route || !devices.some((device) => device.id === route)) return undefined;
      return route;
    } catch {
      return undefined;
    }
  }

  stop(owner: AudioOwner): Promise<void> {
    if (!this.pending || !this.ownership.matches(owner)) return Promise.resolve();
    this.ownership.retire(this.pending.lease, owner);
    this.pending = undefined;
    return Promise.resolve();
  }
}
