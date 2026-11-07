import { discoverOutputs, NativeOutputDriver } from '../../vscode/src/speech_native_output';
import type { OutputDiscovery } from '../../vscode/src/speech_output_router';
import type { AudioCapabilities, AudioDevice } from './index';
import { systemDefault } from './linux_default';

interface Driver {
  available(): boolean;
  play(name: string, wav: Uint8Array, event: (type: 'started' | 'ended' | 'failed') => void): boolean;
  control(action: 'pause' | 'resume' | 'stop'): void;
}
interface Options {
  driver?: Driver;
  discover?: () => Promise<OutputDiscovery>;
  defaultSink?: () => Promise<string | undefined>;
}
const WAIT_MS = 20;
const SINK = /^[a-zA-Z0-9_.:-]{1,200}$/;

/** Reuses the reviewed PipeWire driver and its process-close ownership gate. */
export class LinuxBackend {
  private readonly driver: Driver;
  private readonly discover: () => Promise<OutputDiscovery>;
  private readonly readDefault: () => Promise<string | undefined>;

  constructor(options: Options = {}) {
    this.driver = options.driver ?? new NativeOutputDriver();
    this.discover = options.discover ?? discoverOutputs;
    this.readDefault = options.defaultSink ?? systemDefault;
  }
  async capabilities(): Promise<AudioCapabilities> {
    const output = await this.discover();
    const supported = output.supported;
    const defaultSink = supported ? await this.readDefault() : undefined;
    const defaultOutput =
      defaultSink !== undefined && output.devices.some((device) => device.available && device.choice.name === defaultSink);
    return { backend: 'pipewire', location: 'ui', defaultOutput, deviceSelection: supported, pauseResume: supported };
  }
  async list(): Promise<AudioDevice[]> {
    const output = await this.discover();
    if (!output.supported) return [];
    return output.devices.filter((device) => device.available).map((device) => ({ id: device.choice.name, label: device.label }));
  }
  defaultId(): Promise<string | undefined> {
    return this.readDefault();
  }
  start(name: string, wav: Uint8Array, notify: (type: 'started' | 'ended' | 'canceled' | 'failed') => void) {
    if (!this.driver.available() || !SINK.test(name)) throw new Error('Audio output is unavailable.');
    let terminal = false;
    const started = this.driver.play(name, wav, (type) => {
      if (terminal) return;
      if (type !== 'started') terminal = true;
      notify(type);
    });
    if (!started) throw new Error('Audio output is unavailable.');
    const closed = new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.driver.available()) resolve();
        else setTimeout(check, WAIT_MS);
      };
      check();
    });
    return {
      closed,
      stop: () => {
        if (!terminal) {
          terminal = true;
          this.driver.control('stop');
          notify('canceled');
        }
      },
      pause: () => {
        if (!terminal) this.driver.control('pause');
      },
      resume: () => {
        if (!terminal) this.driver.control('resume');
      },
    };
  }
}
