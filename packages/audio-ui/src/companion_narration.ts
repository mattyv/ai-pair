import type { NarrationPort } from '@ai-pair/core';
import { LOCAL_AUDIO_VERSION, localAudioFrame, type LocalAudioFrame } from '@ai-pair/protocol';
import type { LocalSpeechObservation } from './speech_host';

/** Local speech and reply channel for the companion narration receiver. */
export interface CompanionNarrationOptions {
  epoch: string;
  speech: NarrationPort;
  page: () => number | undefined;
  send: (frame: LocalAudioFrame) => void;
  stopOutput: () => Promise<void>;
  nextSequence: () => number;
  observation: () => LocalSpeechObservation | undefined;
}

interface Job {
  id: string;
  page: number;
  canceled: boolean;
  previousId?: number;
}

/** Runs one received unit locally and reports only its matching terminal result. */
export class CompanionNarration {
  private current?: Job;
  private closed = false;
  private localActions = 0;
  private readonly localPauses = new Set<'draft' | 'manual'>();
  private remotePaused = false;

  constructor(private readonly options: CompanionNarrationOptions) {}

  /** Handles only current, allowlisted controls delivered by the connection lease. */
  receive(value: unknown): boolean {
    const parsed = localAudioFrame.safeParse(value);
    if (!parsed.success || this.closed) return false;
    const frame = parsed.data;
    if (frame.connectionEpoch !== this.options.epoch || !('jobId' in frame)) return false;
    if (frame.type === 'speak' || frame.type === 'attentionCue') {
      if (frame.pageEpoch !== this.options.page() || this.current !== undefined || this.localActions > 0) {
        if (this.current?.id !== frame.jobId || this.current.page !== frame.pageEpoch) {
          this.sendTerminal({ id: frame.jobId, page: frame.pageEpoch, canceled: false }, 'failed');
        }
        return false;
      }
      const job: Job = { id: frame.jobId, page: frame.pageEpoch, canceled: false, previousId: this.options.observation()?.id };
      this.current = job;
      try {
        let playback: Promise<void>;
        if (frame.type === 'speak') {
          playback = this.options.speech.speak(frame.text, frame.delivery);
        } else {
          playback = this.options.speech.attentionCue();
        }
        void playback.then(
          () => {
            const observed = this.options.observation();
            const ended = observed !== undefined && observed.id !== job.previousId && observed.started && observed.terminal === 'ended';
            this.finishPlayback(job, job.canceled ? 'canceled' : ended ? 'ended' : 'failed', frame.type === 'attentionCue');
          },
          () => {
            this.finishPlayback(job, job.canceled ? 'canceled' : 'failed', frame.type === 'attentionCue');
          },
        );
      } catch {
        this.finishPlayback(job, 'failed', frame.type === 'attentionCue');
      }
      return true;
    }
    if (frame.pageEpoch !== this.options.page()) return false;
    const job = this.current;
    if (job === undefined || job.id !== frame.jobId || job.page !== frame.pageEpoch || job.canceled) return false;
    if (frame.type === 'pause') this.setRemotePause(true);
    else if (frame.type === 'resume') this.setRemotePause(false);
    else if (frame.type === 'cancel') this.stopLocally();
    else return false;
    return true;
  }

  /** Adds or clears the local draft pause without overriding the workspace pause. */
  setLocalPause(paused: boolean, reason: 'draft' | 'manual' = 'draft'): void {
    const wasPaused = this.localPauses.size > 0 || this.remotePaused;
    if (paused) this.localPauses.add(reason);
    else this.localPauses.delete(reason);
    this.applyPause(wasPaused);
  }

  /** Updates the workspace pause without overriding a local draft. */
  private setRemotePause(paused: boolean): void {
    const wasPaused = this.localPauses.size > 0 || this.remotePaused;
    this.remotePaused = paused;
    this.applyPause(wasPaused);
  }

  /** Applies only changes in the combined pause state. */
  private applyPause(wasPaused: boolean): void {
    const paused = this.localPauses.size > 0 || this.remotePaused;
    if (paused === wasPaused) return;
    if (paused) this.options.speech.pause();
    else this.options.speech.resume();
  }

  /** Silences locally before a reply, hide, disconnect, or other workspace action. */
  stopLocally(): void {
    const job = this.current;
    if (job?.canceled === true) return;
    if (job !== undefined) job.canceled = true;
    this.options.speech.cancel();
  }

  /** Stops locally before forwarding an action, blocking new speech until it is forwarded. */
  async interruptThen(forward: () => void | Promise<void>): Promise<void> {
    if (this.closed) return;
    this.localActions++;
    try {
      this.stopLocally();
      await this.options.stopOutput();
      if (!this.closed) await forward();
    } finally {
      this.localActions--;
    }
  }

  /** Stops local speech and rejects late callbacks after the connection is lost. */
  dispose(): void {
    this.stopLocally();
    this.closed = true;
  }

  /** Waits for physical retirement when a cue did not end naturally. */
  private finishPlayback(job: Job, outcome: 'ended' | 'canceled' | 'failed', cue: boolean): void {
    if (!cue || outcome === 'ended') {
      this.finish(job, outcome);
      return;
    }
    // specs/RemoteCue.tla, `Retire`: settlement is not physical retirement.
    void this.options.stopOutput().then(
      () => {
        this.finish(job, outcome);
      },
      () => {
        /* Keep ownership when physical retirement is unknown. */
      },
    );
  }

  /** Sends one acknowledgement in the outbound sequence space. */
  private finish(job: Job, outcome: 'ended' | 'canceled' | 'failed'): void {
    if (this.current !== job || this.closed) return;
    this.current = undefined;
    this.setRemotePause(false);
    this.sendTerminal(job, outcome);
  }

  /** Sends a terminal result without changing any other job's ownership. */
  private sendTerminal(job: Job, outcome: 'ended' | 'canceled' | 'failed'): void {
    try {
      this.options.send({
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: this.options.epoch,
        sequence: this.options.nextSequence(),
        type: 'terminal',
        jobId: job.id,
        pageEpoch: job.page,
        outcome,
      });
    } catch {
      // A disconnected workspace cannot receive this acknowledgement.
    }
  }
}
