import { execFile } from 'node:child_process';

const SINK = /^[a-zA-Z0-9_.:-]{1,200}$/;
const TIMEOUT_MS = 5000;
const MAX_DUMP = 1_048_576;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads only the default metadata store from the same graph pw-play uses. */
export function defaultFromDump(text: string): string | undefined {
  let dump: unknown;
  try {
    dump = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(dump)) return undefined;
  let selected: string | undefined;
  for (const object of dump as unknown[]) {
    if (
      !record(object) ||
      object.type !== 'PipeWire:Interface:Metadata' ||
      !record(object.props) ||
      object.props['metadata.name'] !== 'default' ||
      !Array.isArray(object.metadata)
    ) {
      continue;
    }
    for (const entry of object.metadata as unknown[]) {
      if (
        !record(entry) ||
        entry.subject !== 0 ||
        entry.key !== 'default.audio.sink' ||
        !record(entry.value) ||
        typeof entry.value.name !== 'string' ||
        !SINK.test(entry.value.name)
      ) {
        continue;
      }
      if (selected !== undefined) return undefined;
      selected = entry.value.name;
    }
  }
  return selected;
}

export function systemDefault(): Promise<string | undefined> {
  if ((process.env.PIPEWIRE_REMOTE ?? '') !== '') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile('pw-dump', [], { timeout: TIMEOUT_MS, maxBuffer: MAX_DUMP, env: { ...process.env, LC_ALL: 'C' } }, (error, output) => {
      resolve(error ? undefined : defaultFromDump(output));
    });
  });
}
