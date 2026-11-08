import { execFile, spawn } from 'node:child_process';
import type { AudioCapabilities, AudioDevice } from './index';
import { parseCatalog } from './helper_catalog';
import { HelperEventFrames } from './protocol';

const MAX_CATALOG = 65_536;
const TIMEOUT_MS = 5000;

type Outcome = 'started' | 'ended' | 'canceled' | 'failed';

/** A single verified, fixed helper executable; the path comes only from local packaging. */
export class HelperBackend {
  constructor(
    private readonly binary: string,
    private readonly identity: 'coreaudio' | 'wasapi',
  ) {}

  private catalog(): Promise<ReturnType<typeof parseCatalog>> {
    return new Promise((resolve) => {
      try {
        execFile(this.binary, ['--list'], { timeout: TIMEOUT_MS, maxBuffer: MAX_CATALOG, windowsHide: true }, (error, output) => {
          resolve(error ? undefined : parseCatalog(output));
        });
      } catch {
        resolve(undefined);
      }
    });
  }
  async capabilities(): Promise<AudioCapabilities> {
    const catalog = await this.catalog();
    return {
      backend: this.identity,
      location: 'ui',
      defaultOutput: typeof catalog?.defaultId === 'string',
      deviceSelection: catalog !== undefined,
      pauseResume: catalog !== undefined,
    };
  }
  async list(): Promise<AudioDevice[]> {
    return (await this.catalog())?.devices ?? [];
  }
  async defaultId(): Promise<string | undefined> {
    return (await this.catalog())?.defaultId ?? undefined;
  }

  start(id: string, wav: Uint8Array, notify: (type: Outcome) => void) {
    const child = spawn(this.binary, ['--play'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let sequence = 0;
    let ready = false;
    let playSent = false;
    let started = false;
    let paused = false;
    let stopping = false;
    let terminal: Exclude<Outcome, 'started'> | undefined;
    let notified = false;
    let retired = false;
    let exited = false;
    let failed = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const acknowledgements: Array<'paused' | 'resumed'> = [];

    function terminalEvent(type: Exclude<Outcome, 'started'>): void {
      if (notified) return;
      notified = true;
      notify(type);
    }
    function cancelDeadline(): void {
      if (deadline !== undefined) clearTimeout(deadline);
      deadline = undefined;
    }
    function fail(): void {
      if (exited || failed) return;
      failed = true;
      cancelDeadline();
      terminalEvent('failed');
      try {
        child.kill();
      } catch {
        // The process is still owned until its close notification.
      }
    }
    function armDeadline(): void {
      cancelDeadline();
      deadline = setTimeout(fail, TIMEOUT_MS);
    }
    function send(type: string, extra: Record<string, string> = {}): void {
      try {
        child.stdin.write(`${JSON.stringify({ version: 1, sequence: sequence++, type, ...extra })}\n`);
      } catch {
        fail();
      }
    }
    function startAudio(): void {
      if (!ready || paused || stopping || playSent || failed) return;
      playSent = true;
      armDeadline();
      send('play', { wav: Buffer.from(wav).toString('base64') });
    }
    const frames = new HelperEventFrames((event) => {
      if (failed || exited) return;
      if (retired || (terminal && event.type !== 'retired')) {
        fail();
        return;
      }
      // The parser has already restricted event.type to the exhaustive union.
      // oxlint-disable-next-line eslint/default-case
      switch (event.type) {
        case 'ready':
          if (ready) {
            fail();
            return;
          }
          ready = true;
          if (!stopping) cancelDeadline();
          startAudio();
          break;
        case 'started':
          if (!ready || !playSent || started) {
            fail();
            return;
          }
          started = true;
          if (!stopping) {
            if (acknowledgements.length === 0) cancelDeadline();
            notify('started');
          }
          break;
        case 'paused':
        case 'resumed':
          if (!started || acknowledgements.shift() !== event.type) {
            fail();
            return;
          }
          if (!stopping && acknowledgements.length === 0) cancelDeadline();
          break;
        case 'ended':
          if (!started) {
            fail();
            return;
          }
          terminal = stopping ? 'canceled' : 'ended';
          armDeadline();
          break;
        case 'canceled':
          if (!stopping) {
            fail();
            return;
          }
          terminal = 'canceled';
          armDeadline();
          break;
        case 'failed':
          terminal = 'failed';
          armDeadline();
          break;
        case 'retired':
          if (!terminal) {
            fail();
            return;
          }
          retired = true;
          armDeadline();
          break;
      }
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (!frames.push(chunk)) fail();
    });
    child.stdout.on('end', () => {
      if (!frames.finish() || !retired) fail();
    });
    child.stdin.on('error', fail);
    child.once('error', fail);
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => {
        exited = true;
        cancelDeadline();
        terminalEvent(retired && terminal !== undefined ? terminal : 'failed');
        resolve();
      });
    });
    armDeadline();
    send('open', { id });
    return {
      closed,
      stop: () => {
        if (!stopping && !terminal && !failed && !exited) {
          stopping = true;
          armDeadline();
          send('stop');
        }
      },
      pause: () => {
        if (!paused && !terminal && !stopping && !failed && !exited) {
          paused = true;
          if (playSent) {
            acknowledgements.push('paused');
            armDeadline();
            send('pause');
          }
        }
      },
      resume: () => {
        if (paused && !terminal && !stopping && !failed && !exited) {
          paused = false;
          if (playSent) {
            acknowledgements.push('resumed');
            armDeadline();
            send('resume');
          } else startAudio();
        }
      },
    };
  }
}
