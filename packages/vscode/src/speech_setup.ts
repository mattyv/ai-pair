import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MODEL_ASSETS, MODEL_REVISION, MODEL_URL } from './speech_model_manifest';

const MAX_REDIRECTS = 4;
const DOWNLOAD_TIMEOUT_MS = 900_000;
// HTTP status codes are protocol-defined.
// eslint-disable-next-line no-magic-numbers
const HTTP_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PERCENT = 100;

/** Follows only HTTPS redirects within the fixed download hosts. */
async function modelResponse(url: string, signal: AbortSignal): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.username !== '' ||
      current.password !== '' ||
      current.port !== '' ||
      !(
        current.hostname === 'cdn.jsdelivr.net' ||
        current.hostname === 'huggingface.co' ||
        current.hostname.endsWith('.huggingface.co') ||
        current.hostname.endsWith('.hf.co')
      )
    ) {
      throw new Error('Speech model download redirected to an unsupported host.');
    }
    const response = await fetch(current, { signal, redirect: 'manual' });
    if (!HTTP_REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get('location');
    if (location === null) throw new Error('Speech model download redirect is invalid.');
    current = new URL(location, current);
  }
  throw new Error('Speech model download redirected too many times.');
}

/** Returns whether all pinned files exist and match their expected content. */
async function verified(directory: string): Promise<boolean> {
  try {
    for (const asset of MODEL_ASSETS) {
      const file = path.join(directory, asset.path);
      const info = await fs.stat(file);
      if (!info.isFile() || info.size !== asset.size) return false;
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
        size += chunk.byteLength;
        if (size > asset.size) return false;
        hash.update(chunk);
      }
      if (size !== asset.size || hash.digest('hex') !== asset.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns the fixed installed model path only when every asset verifies. */
export async function installedSpeechModel(storageDirectory: string): Promise<string | undefined> {
  const directory = path.join(storageDirectory, 'speech', MODEL_REVISION);
  return (await verified(directory)) ? directory : undefined;
}

/** Identifies a missing file error without exposing paths or exception text. */
function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Downloads a fixed asset to staging while enforcing its exact size and digest. */
async function downloadAsset(
  directory: string,
  asset: (typeof MODEL_ASSETS)[number],
  signal: AbortSignal,
  report: (bytes: number) => void,
): Promise<void> {
  const url = 'url' in asset ? asset.url : `${MODEL_URL}/${asset.path}`;
  const response = await modelResponse(url, signal);
  if (!response.ok || response.body === null) throw new Error('Speech model download failed.');
  const file = path.join(directory, asset.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx');
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const hash = createHash('sha256');
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      if (signal.aborted) throw new Error('Speech setup cancelled.');
      const next = await reader.read();
      if (next.done) {
        complete = true;
        break;
      }
      size += next.value.byteLength;
      if (size > asset.size) throw new Error('Speech model verification failed.');
      hash.update(next.value);
      await handle.writeFile(next.value);
      report(next.value.byteLength);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
    await handle.close();
  }
  if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Speech model verification failed.');
}

/** Downloads and atomically installs the pinned speech model after verification. */
export async function setupSpeech(storageDirectory: string): Promise<void> {
  if ((await installedSpeechModel(storageDirectory)) !== undefined) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Setting up local speech (94 MB)', cancellable: true },
    async (progress, token) => {
      const abort = new AbortController();
      const cancellation = token.onCancellationRequested(() => {
        abort.abort();
      });
      if (token.isCancellationRequested) abort.abort();
      const root = path.join(storageDirectory, 'speech');
      const target = path.join(root, MODEL_REVISION);
      const total = MODEL_ASSETS.reduce((sum, asset) => sum + asset.size, 0);
      let staging: string | undefined;
      let backup: string | undefined;
      let committed = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, DOWNLOAD_TIMEOUT_MS);
      try {
        if (abort.signal.aborted) throw new Error('Speech setup cancelled.');
        await fs.mkdir(root, { recursive: true });
        staging = await fs.mkdtemp(path.join(root, '.setup-'));
        for (const asset of MODEL_ASSETS) {
          await downloadAsset(staging, asset, abort.signal, (bytes) => {
            progress.report({ increment: (bytes / total) * PERCENT });
          });
        }
        // specs/SpeechSetup.tla, Verify and Commit: only a complete verified model becomes visible.
        if (!(await verified(staging))) throw new Error('Speech model verification failed.');
        if (abort.signal.aborted) throw new Error('Speech setup cancelled.');
        if ((await installedSpeechModel(storageDirectory)) !== undefined) return;
        if (abort.signal.aborted) throw new Error('Speech setup cancelled.');
        backup = `${staging}.old`;
        try {
          await fs.rename(target, backup);
        } catch (error) {
          if (!missing(error)) throw error;
          backup = undefined;
        }
        try {
          if (abort.signal.aborted) throw new Error('Speech setup cancelled.');
          await fs.rename(staging, target);
          staging = undefined;
          committed = true;
        } catch (error) {
          if (backup !== undefined) {
            await fs.rename(backup, target);
            backup = undefined;
          }
          throw error;
        }
      } catch (error) {
        if (timedOut) throw new Error('Speech model download timed out.', { cause: error });
        if (abort.signal.aborted) throw new Error('Speech setup cancelled.', { cause: error });
        throw error;
      } finally {
        clearTimeout(timer);
        cancellation.dispose();
        if (staging !== undefined) await fs.rm(staging, { recursive: true, force: true });
        if (backup !== undefined && committed) await fs.rm(backup, { recursive: true, force: true });
      }
    },
  );
}
