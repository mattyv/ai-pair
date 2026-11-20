import { spawn } from 'node:child_process';
import { addAbortListener } from 'node:events';
import { z } from 'zod';
import { WORKER_ACK_SCHEMA, WORKER_GRANT_SCHEMA, WORKER_MESSAGE_ID_LIMIT, WORKER_MODEL_LIMIT, WORKER_TEXT_LIMIT } from '@ai-pair/protocol';
import type { EditorLink } from './link';
import { parseWorkerRecord, readWorkerLines, type WorkerTranscriptInput } from './worker_output';

const RUN_TIMEOUT_MS = 300_000;
const STOP_TIMEOUT_MS = 2000;
const RELEASE_TIMEOUT_MS = 10_000;
const ITEM_LIMIT = 64;
const EARLY_EVENT_LIMIT = 64;
const RPC_METHOD_NOT_FOUND = -32_601;
const INITIALIZE_ID = 1;
const THREAD_START_ID = 2;
const TURN_START_ID = 3;
const DELTA = 'item/agentMessage/delta';
const ITEM_COMPLETED = 'item/completed';
const TURN_COMPLETED = 'turn/completed';

/** The failure message the runner may display outside its private inputs. */
export const CODEX_WORKER_FAILURE = 'Codex worker failed.';

const SETTINGS = z.strictObject({
  model: z
    .string()
    .min(1)
    .max(WORKER_MODEL_LIMIT)
    .refine((value) => value.trim() !== ''),
  prompt: z.string().min(1).max(WORKER_TEXT_LIMIT),
});
const RPC_FRAME = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const PROVIDER_ID = z.string().min(1).max(WORKER_MESSAGE_ID_LIMIT);
const ITEM_TEXT = z.string().max(WORKER_TEXT_LIMIT);
const THREAD_REPLY = z.object({ thread: z.object({ id: PROVIDER_ID }) });
const TURN_REPLY = z.object({ turn: z.object({ id: PROVIDER_ID }) });
const TURN_RESULT = z.object({ turn: z.object({ id: PROVIDER_ID, status: z.string() }) });
const THREAD_SCOPE = z.object({ threadId: PROVIDER_ID });
const TURN_SCOPE = z.object({ turnId: PROVIDER_ID });
const DELTA_PARAMS = z.object({ itemId: PROVIDER_ID, delta: ITEM_TEXT });
const COMPLETED_ITEM_TYPE = z.object({ item: z.object({ type: z.string() }) });
const COMPLETED_ITEM = z.object({ item: z.object({ id: PROVIDER_ID, text: ITEM_TEXT }) });

type WorkerGrant = z.infer<typeof WORKER_GRANT_SCHEMA>;
type RpcFrame = z.infer<typeof RPC_FRAME>;
type WorkerLink = Pick<EditorLink, 'callWorker'>;
type LineIterator = AsyncGenerator<string | undefined, void>;

/** Owns the private stdio and retirement of one app-server process. */
export interface CodexWorkerChild {
  output: WorkerTranscriptInput;
  send(record: Record<string, unknown>): Promise<void>;
  stop(): Promise<void>;
}

/** Selects the launching workspace and permits deterministic process and timeout tests. */
export interface CodexWorkerOptions {
  cwd: string;
  launch?: (cwd: string) => CodexWorkerChild;
  signal?: AbortSignal | undefined;
}

/** Awaits a single effect until its owner aborts. */
async function untilAbort<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const abort = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => {
    abort.reject(new Error(CODEX_WORKER_FAILURE));
  });
  try {
    return await Promise.race([abort.promise, start()]);
  } finally {
    listener[Symbol.dispose]();
  }
}

/** Starts the installed Codex app-server with private pipes and no shell. */
function launchCodex(cwd: string): CodexWorkerChild {
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { cwd, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
  const close = Promise.withResolvers<void>();
  child.once('close', () => {
    close.resolve();
  });
  // The record reader and write callback surface failure without copying process errors to the caller.
  child.on('error', () => {});
  child.stdin.on('error', () => {});

  return {
    output: child.stdout,
    send: (record) =>
      new Promise((resolve, reject) => {
        child.stdin.write(`${JSON.stringify(record)}\n`, (error) => {
          if (error !== undefined && error !== null) {
            reject(new Error(CODEX_WORKER_FAILURE));
          } else {
            resolve();
          }
        });
      }),
    async stop() {
      // Drains unread private bytes so the close event can retire the process and its pipes.
      child.stdout.resume();
      child.kill('SIGTERM');
      try {
        await untilAbort(AbortSignal.timeout(STOP_TIMEOUT_MS), () => close.promise);
      } catch {
        child.kill('SIGKILL');
        try {
          await untilAbort(AbortSignal.timeout(STOP_TIMEOUT_MS), () => close.promise);
        } catch {
          // A missing close is a blocked retirement, even after the launcher drops its pipes.
          child.stdin.destroy();
          child.stdout.destroy();
          child.unref();
          throw new Error(CODEX_WORKER_FAILURE);
        }
      }
    },
  };
}

/** Reads one usable RPC frame, refusing server-originated questions without echoing their payload. */
async function receive(child: CodexWorkerChild, lines: LineIterator, signal: AbortSignal): Promise<RpcFrame> {
  for (;;) {
    const next = await untilAbort(signal, () => lines.next());
    if (next.done === true) throw new Error(CODEX_WORKER_FAILURE);
    if (next.value?.trim() === '') continue;
    const frame = RPC_FRAME.parse(parseWorkerRecord(next.value));
    if (frame.method === undefined || frame.id === undefined) return frame;
    await untilAbort(signal, () =>
      child.send({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: RPC_METHOD_NOT_FOUND, message: 'Unsupported Codex request.' },
      }),
    );
  }
}

/** Reads one required private input record. */
async function readPrivate(lines: LineIterator, signal: AbortSignal): Promise<unknown> {
  const next = await untilAbort(signal, () => lines.next());
  if (next.done === true) throw new Error(CODEX_WORKER_FAILURE);
  return parseWorkerRecord(next.value);
}

/** Sends an RPC request and reads until its exact response, retaining relevant intervening events. */
async function request(
  child: CodexWorkerChild,
  lines: LineIterator,
  signal: AbortSignal,
  message: { id: number; method: string; params: Record<string, unknown> },
  onEvent?: (frame: RpcFrame) => void,
): Promise<unknown> {
  await untilAbort(signal, () => child.send({ jsonrpc: '2.0', ...message }));
  for (;;) {
    const frame = await receive(child, lines, signal);
    if (frame.id !== message.id) {
      onEvent?.(frame);
      continue;
    }
    if (frame.error !== undefined || frame.result === undefined) throw new Error(CODEX_WORKER_FAILURE);
    return frame.result;
  }
}

/** Checks the thread before interpreting a notification's other fields. */
function isInThread(frame: RpcFrame, threadId: string): boolean {
  return THREAD_SCOPE.safeParse(frame.params).data?.threadId === threadId;
}

/** Sends one cumulative snapshot after validating its exact worker grant and public message identity. */
async function publish(
  link: WorkerLink,
  grant: WorkerGrant,
  signal: AbortSignal,
  message: string,
  text: string,
  final = false,
): Promise<void> {
  if (message.includes(grant.capability)) throw new Error(CODEX_WORKER_FAILURE);
  WORKER_ACK_SCHEMA.parse(
    await untilAbort(signal, () =>
      link.callWorker(
        grant.port,
        'worker_output',
        {
          capability: grant.capability,
          message,
          text,
          ...(final ? { final: true } : {}),
        },
        signal,
      ),
    ),
  );
}

/** Streams one exact turn and succeeds only on its completed notification. */
async function runTurn(
  child: CodexWorkerChild,
  lines: LineIterator,
  signal: AbortSignal,
  link: WorkerLink,
  grant: WorkerGrant,
  cwd: string,
  settings: z.infer<typeof SETTINGS>,
): Promise<boolean> {
  await request(child, lines, signal, {
    id: INITIALIZE_ID,
    method: 'initialize',
    params: { clientInfo: { name: 'ai-pair', title: 'AI Pair', version: '1' } },
  });
  await untilAbort(signal, () => child.send({ jsonrpc: '2.0', method: 'initialized' }));
  const thread = THREAD_REPLY.parse(
    await request(child, lines, signal, {
      id: THREAD_START_ID,
      method: 'thread/start',
      params: { cwd, model: settings.model, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' },
    }),
  ).thread.id;
  const early: RpcFrame[] = [];
  const turn = TURN_REPLY.parse(
    await request(
      child,
      lines,
      signal,
      {
        id: TURN_START_ID,
        method: 'turn/start',
        params: { threadId: thread, input: [{ type: 'text', text: settings.prompt, text_elements: [] }] },
      },
      (frame) => {
        if ((frame.method === DELTA || frame.method === ITEM_COMPLETED || frame.method === TURN_COMPLETED) && isInThread(frame, thread)) {
          if (early.length >= EARLY_EVENT_LIMIT) throw new Error(CODEX_WORKER_FAILURE);
          early.push(frame);
        }
      },
    ),
  ).turn.id;

  // specs/WorkerSnapshots.tla, Output: one item retains its identity across cumulative updates.
  const items = new Map<string, string | undefined>();
  for (;;) {
    const frame = early.shift() ?? (await receive(child, lines, signal));
    if (!isInThread(frame, thread)) continue;
    if (frame.method === TURN_COMPLETED) {
      const { turn: result } = TURN_RESULT.parse(frame.params);
      if (result.id === turn) return result.status === 'completed' && Array.from(items.values()).every((text) => text === undefined);
    } else if (TURN_SCOPE.safeParse(frame.params).data?.turnId === turn) {
      if (frame.method === DELTA) {
        const { itemId, delta } = DELTA_PARAMS.parse(frame.params);
        if (delta === '') continue;
        const previous = items.get(itemId);
        if (previous === undefined && items.has(itemId)) continue;
        if (!items.has(itemId) && items.size >= ITEM_LIMIT) return false;
        const text = ITEM_TEXT.parse((previous ?? '') + delta);
        items.set(itemId, text);
        await publish(link, grant, signal, itemId, text);
      } else if (frame.method === ITEM_COMPLETED && COMPLETED_ITEM_TYPE.parse(frame.params).item.type === 'agentMessage') {
        const {
          item: { id, text },
        } = COMPLETED_ITEM.parse(frame.params);
        if (items.has(id) && items.get(id) === undefined) continue;
        if (!items.has(id) && items.size >= ITEM_LIMIT) return false;
        if (text === '' && items.has(id)) return false;
        items.set(id, undefined);
        if (text !== '') await publish(link, grant, signal, id, text, /* final= */ true);
      }
    }
  }
}

/** Accepts a private grant and launch settings, streams public Codex output, and retires the worker. */
export async function runCodexWorker(input: WorkerTranscriptInput, link: WorkerLink, options: CodexWorkerOptions): Promise<boolean> {
  const signal = options.signal ?? AbortSignal.timeout(RUN_TIMEOUT_MS);
  const privateInput = readWorkerLines(input);
  let grant: WorkerGrant | undefined;
  let child: CodexWorkerChild | undefined;
  let output: LineIterator | undefined;
  let succeeded = false;
  let retired = true;
  try {
    const authority = WORKER_GRANT_SCHEMA.parse(await readPrivate(privateInput, signal));
    grant = authority;
    const settings = SETTINGS.parse(await readPrivate(privateInput, signal));
    if (authority.model !== undefined && authority.model !== settings.model) throw new Error(CODEX_WORKER_FAILURE);
    WORKER_ACK_SCHEMA.parse(
      await untilAbort(signal, () =>
        link.callWorker(
          authority.port,
          'worker_progress',
          {
            capability: authority.capability,
            text: 'Connecting live Codex output.',
          },
          signal,
        ),
      ),
    );
    signal.throwIfAborted();
    child = (options.launch ?? launchCodex)(options.cwd);
    output = readWorkerLines(child.output);
    succeeded = await runTurn(child, output, signal, link, grant, options.cwd, settings);
  } catch {
    succeeded = false;
  } finally {
    if (child !== undefined) {
      try {
        await child.stop();
      } catch {
        retired = false;
      }
    }
    void privateInput.return(undefined).catch(() => {});
    void output?.return(undefined).catch(() => {});
  }
  if (grant === undefined) return false;

  const { port, capability } = grant;
  const release = AbortSignal.timeout(RELEASE_TIMEOUT_MS);
  try {
    if (retired) {
      const text = succeeded ? 'Codex worker finished.' : CODEX_WORKER_FAILURE;
      WORKER_ACK_SCHEMA.parse(await untilAbort(release, () => link.callWorker(port, 'worker_done', { capability, text }, release)));
    } else {
      // A successor needs explicit cancellation while the old child lacks retirement evidence.
      const text = 'Codex worker retirement could not be confirmed.';
      WORKER_ACK_SCHEMA.parse(
        await untilAbort(release, () => link.callWorker(port, 'worker_notice', { capability, notice: 'blocked', text }, release)),
      );
    }
  } catch {
    return false;
  }
  return succeeded && retired;
}
