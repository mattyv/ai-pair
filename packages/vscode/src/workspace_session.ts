import { CommandChannel, LOCAL_AUDIO_VERSION, type LocalAudioFrame, type LocalPanelAction } from '@ai-pair/protocol';
import { PanelUpdateSender } from './panel_update_sender';
import { RemoteNarration } from './remote_narration';
import { WorkspacePanelBridge } from './workspace_panel_bridge';
import { SPEECH_TEMPO_TIMEOUT_MS } from './speech_tempo_client';

/** Interval between connection lease heartbeats. */
const HEARTBEAT_MS = 3000;
/** Maximum time to wait for one command acknowledgement. */
const COMMAND_TIMEOUT_MS = 3000;
/** Maximum queued commands before failing the connection closed. */
const MAX_PENDING_COMMANDS = 128;
/** Unpaused admission deadline in SpeechService. */
const ADMISSION_MS = 5000;
/** Worker load, each inference, and each playback-start deadline. */
const STAGE_MS = 20_000;
/** Maximum number of Kokoro parts in one admitted unit. */
const MAX_PARTS = 4;
/** The aggregate waveform limit, including the final thinking tail. */
const MAX_AUDIO_MS = 40_600;
/** Playback grace allowed for each part. */
const PART_GRACE_MS = 5000;
/** Allows bounded transport and scheduling overhead. */
const TRANSPORT_MARGIN_MS = 25_000;
/**
 * Unpaused upper backstop for admission, load, every inference and start,
 * aggregate audio, each tempo transform, each playback grace and transport. RemoteNarration retains
 * ownership after this timer settles the caller until terminal acknowledgement.
 */
const NARRATION_TIMEOUT_MS =
  ADMISSION_MS +
  STAGE_MS +
  MAX_PARTS * STAGE_MS * 2 +
  MAX_PARTS * SPEECH_TEMPO_TIMEOUT_MS +
  MAX_AUDIO_MS +
  MAX_PARTS * PART_GRACE_MS +
  TRANSPORT_MARGIN_MS;

/** Workspace panel operations needed by the companion connection. */
export interface WorkspaceSessionPanel {
  attachRemote(page: number, send: (message: unknown) => void): void;
  receiveRemote(page: number, action: LocalPanelAction): void;
  closeRemote(page: number): void;
}

/** Dependencies for the workspace half of an attached companion session. */
export interface WorkspaceSessionOptions {
  epoch: string;
  panel: WorkspaceSessionPanel;
  send: (frame: LocalAudioFrame) => Promise<void>;
  lost: () => void;
  unavailable?: () => void;
}

/** Connects workspace panel events and narration to the selected local companion. */
export class WorkspaceSession {
  readonly narration: RemoteNarration;
  private readonly channel: CommandChannel<LocalAudioFrame>;
  private readonly bridge: WorkspacePanelBridge;
  private readonly updates: PanelUpdateSender;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private sequence = 1;
  private closed = false;

  constructor(private readonly options: WorkspaceSessionOptions) {
    const nextSequence = (): number => ++this.sequence;
    this.channel = new CommandChannel({
      send: options.send,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxPending: MAX_PENDING_COMMANDS,
      lost: () => {
        this.stop(true);
      },
    });
    this.narration = new RemoteNarration({
      epoch: options.epoch,
      page: () => this.bridge.page(),
      timeoutMs: NARRATION_TIMEOUT_MS,
      nextSequence,
      send: (frame) => {
        void this.channel.send(frame);
      },
    });
    this.updates = new PanelUpdateSender({
      epoch: options.epoch,
      page: () => this.bridge.page(),
      nextSequence,
      send: (frame) => this.channel.send(frame),
      unavailable: () => {
        options.unavailable?.();
      },
    });
    this.bridge = new WorkspacePanelBridge({
      epoch: options.epoch,
      action: (action) => {
        const page = this.bridge.page();
        if (page === undefined) return;
        if (action.type === 'ready') {
          options.panel.attachRemote(page, (message) => {
            void this.updates.post(message);
          });
        }
        options.panel.receiveRemote(page, action);
      },
      terminal: (frame) => {
        this.narration.ack(frame);
      },
      pageChanged: () => {
        this.narration.cancel();
      },
    });
    this.heartbeat = setInterval(() => {
      void this.channel.send({ version: LOCAL_AUDIO_VERSION, connectionEpoch: options.epoch, sequence: nextSequence(), type: 'heartbeat' });
    }, HEARTBEAT_MS);
  }

  /** Reports whether the current companion page has completed its ready handshake. */
  pageReady(): boolean {
    return this.bridge.page() !== undefined;
  }

  /** Dispatches an ordered companion action or terminal acknowledgement. */
  accept(value: unknown): boolean {
    return this.bridge.accept(value);
  }

  /** Disposes the selected connection without switching back to a legacy owner. */
  dispose(): void {
    this.stop(false);
  }

  /** Stops the session, preserving the selected owner after connection failure. */
  private stop(notify: boolean): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    const page = this.bridge.page();
    this.narration.dispose();
    this.bridge.dispose();
    if (page !== undefined) this.options.panel.closeRemote(page);
    this.channel.dispose();
    if (notify) this.options.lost();
  }
}
