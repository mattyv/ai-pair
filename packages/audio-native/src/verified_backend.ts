import type { AudioCapabilities, AudioDevice } from './index';
import { HelperBackend } from './helper_backend';
import { resolveBundledHelper } from './helper_manifest';

type Outcome = 'started' | 'ended' | 'canceled' | 'failed';
const UNAVAILABLE: AudioCapabilities = {
  backend: 'unavailable',
  location: 'ui',
  defaultOutput: false,
  deviceSelection: false,
  pauseResume: false,
};

/** A local package backend cannot start a process before its fixed asset is verified. */
export class VerifiedBackend {
  private readonly ready: Promise<HelperBackend | undefined>;
  private backend?: HelperBackend;
  constructor(root: string, platform: string, architecture: string) {
    this.ready = resolveBundledHelper(root, platform, architecture).then((path) => {
      if (path === undefined) return undefined;
      this.backend = new HelperBackend(path, platform === 'darwin' ? 'coreaudio' : 'wasapi');
      return this.backend;
    });
  }
  async capabilities(): Promise<AudioCapabilities> {
    return (await this.ready)?.capabilities() ?? UNAVAILABLE;
  }
  async list(): Promise<AudioDevice[]> {
    return (await this.ready)?.list() ?? [];
  }
  async defaultId(): Promise<string | undefined> {
    return (await this.ready)?.defaultId();
  }
  start(id: string, wav: Uint8Array, event: (type: Outcome) => void) {
    if (!this.backend) throw new Error('Audio output is unavailable.');
    return this.backend.start(id, wav, event);
  }
}
