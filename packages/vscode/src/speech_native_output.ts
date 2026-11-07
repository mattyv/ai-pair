import { execFile, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { OutputDiscovery } from './speech_output_router';
import type { OutputDevice } from './speech_output_types';

const LIMIT = 1_948_844;
const MIN_WAV = 44;
const MAX_DEVICES = 64;
const MAX_LABEL = 200;
const MARKER_BUFFER = 256;
const START_TIMEOUT = 5000;
const NAME = /^[a-zA-Z0-9_.:-]{1,200}$/;
const STREAMING = 'stream state changed paused -> streaming';

/** Runs a fixed local program, bounding both response size and elapsed time. */
function command(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(program, args, { timeout: START_TIMEOUT, maxBuffer: 1_048_576, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** Discovers local PipeWire sinks; never exposes raw process output. */
export async function discoverOutputs(): Promise<OutputDiscovery> {
  if (process.platform !== 'linux' || (process.env.PIPEWIRE_REMOTE ?? '') !== '') {
    return { supported: false, devices: [], reason: 'unsupported' };
  }
  try {
    const [dumpText, , setprivHelp] = await Promise.all([
      command('pw-dump', []),
      command('pw-play', ['--version']),
      command('setpriv', ['--help']),
    ]);
    if (!setprivHelp.includes('--pdeathsig')) return { supported: false, devices: [], reason: 'unsupported' };
    const nodes: unknown = JSON.parse(dumpText);
    if (!Array.isArray(nodes)) return { supported: false, devices: [], reason: 'invalid' };
    const devices: OutputDevice[] = [];
    for (const node of nodes as unknown[]) {
      if (devices.length >= MAX_DEVICES) break;
      if (
        typeof node !== 'object' ||
        node === null ||
        !('type' in node) ||
        node.type !== 'PipeWire:Interface:Node' ||
        !('info' in node) ||
        typeof node.info !== 'object' ||
        node.info === null ||
        !('props' in node.info) ||
        typeof node.info.props !== 'object' ||
        node.info.props === null
      ) {
        continue;
      }
      const props = node.info.props;
      if (
        !('media.class' in props) ||
        props['media.class'] !== 'Audio/Sink' ||
        !('node.name' in props) ||
        typeof props['node.name'] !== 'string' ||
        !NAME.test(props['node.name'])
      ) {
        continue;
      }
      const name = props['node.name'];
      const label =
        'node.description' in props && typeof props['node.description'] === 'string' ? props['node.description'].slice(0, MAX_LABEL) : name;
      devices.push({ choice: { kind: 'native', backend: 'pipewire', name }, label, available: true });
    }
    return { supported: true, devices };
  } catch {
    return { supported: false, devices: [], reason: 'unavailable' };
  }
}

interface NativeChild {
  stdin: Writable;
  stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal: NodeJS.Signals): boolean;
}
interface NativeOptions {
  spawn?: () => NativeChild;
}
interface Job {
  child: NativeChild;
  callback(event: 'started' | 'ended' | 'failed'): void;
  stopped: boolean;
  paused: boolean;
  started: boolean;
  ready: boolean;
  failed: boolean;
  tail: string;
  remaining: number;
  deadline: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** One process stays owned until close, including after stop or startup timeout. */
export class NativeOutputDriver {
  private job?: Job;
  constructor(private readonly options: NativeOptions = {}) {}

  /** True only after every earlier native process has closed. */
  available(): boolean {
    return this.job === undefined;
  }

  play(name: string, wav: Uint8Array, callback: Job['callback']): boolean {
    if (this.job !== undefined || !NAME.test(name) || wav.length < MIN_WAV || wav.length > LIMIT) return false;
    let child: NativeChild;
    try {
      child =
        this.options.spawn?.() ??
        spawn(
          'setpriv',
          [
            '--pdeathsig=KILL',
            '--',
            'pw-play',
            '--verbose',
            `--target=${name}`,
            '--latency=50ms',
            '--properties={ node.dont-fallback=true node.dont-reconnect=true node.dont-move=true }',
            '-',
          ],
          { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, LC_ALL: 'C' } },
        );
    } catch {
      return false;
    }
    const job: Job = {
      child,
      callback,
      stopped: false,
      paused: false,
      started: false,
      ready: false,
      failed: false,
      tail: '',
      remaining: START_TIMEOUT,
      deadline: 0,
    };
    this.job = job;
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.job !== job || job.stopped || job.failed || job.started) return;
      job.tail = (job.tail + chunk.toString('utf8')).slice(-MARKER_BUFFER);
      if (job.tail.includes(STREAMING)) {
        job.ready = true;
        if (!job.paused) this.started(job);
      }
    });
    child.stdin.on('error', () => {});
    child.once('error', () => {
      this.fail(job);
    });
    child.once('close', (code) => {
      if (this.job !== job) return;
      this.clear(job);
      this.job = undefined;
      if (job.stopped || job.failed) return;
      if (code === 0 && job.started) callback('ended');
      else callback('failed');
    });
    this.arm(job);
    try {
      child.stdin.end(wav);
    } catch {
      this.fail(job);
    }
    return true;
  }

  control(action: 'pause' | 'resume' | 'stop'): void {
    const job = this.job;
    if (job === undefined || job.stopped || job.failed) return;
    if (action === 'stop') {
      job.stopped = true;
      this.clear(job);
      job.child.kill('SIGKILL');
    } else if (action === 'pause' && !job.paused) {
      job.paused = true;
      if (!job.started) {
        job.remaining = Math.max(0, job.deadline - Date.now());
        this.clear(job);
      }
      job.child.kill('SIGSTOP');
    } else if (action === 'resume' && job.paused) {
      job.paused = false;
      job.child.kill('SIGCONT');
      if (!job.started) {
        if (job.ready) this.started(job);
        else this.arm(job);
      }
    }
  }

  private started(job: Job): void {
    this.clear(job);
    job.started = true;
    job.callback('started');
  }
  private arm(job: Job): void {
    job.deadline = Date.now() + job.remaining;
    job.timer = setTimeout(() => {
      this.fail(job);
    }, job.remaining);
  }
  private clear(job: Job): void {
    if (job.timer !== undefined) clearTimeout(job.timer);
    job.timer = undefined;
  }
  private fail(job: Job): void {
    if (this.job !== job || job.stopped || job.failed) return;
    job.failed = true;
    this.clear(job);
    job.child.kill('SIGKILL');
    job.callback('failed');
  }
}
