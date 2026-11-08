import * as fs from 'node:fs';

const MAX_MAPS_BYTES = 1_048_576;

export type SpeechPlatformResult =
  { supported: true } | { supported: false; reason: 'host_platform' | 'host_arch' | 'libc_unknown' | 'libc_report_failed' };

export interface SpeechPlatformProbe {
  platform: string;
  arch: string;
  report: () => unknown;
  maps: () => string;
}

/** Reads only the current process mappings, refusing an incomplete result. */
export function processMaps(): string {
  const fd = fs.openSync('/proc/self/maps', 'r');
  try {
    const data = Buffer.alloc(MAX_MAPS_BYTES + 1);
    let used = 0;
    while (used < data.length) {
      // null asks Node to continue from the descriptor's current offset.
      // oxlint-disable-next-line unicorn/no-null
      const read = fs.readSync(fd, data, used, data.length - used, null);
      if (read === 0) break;
      used += read;
    }
    if (used > MAX_MAPS_BYTES) throw new Error('Process mappings exceed the limit.');
    return data.toString('utf8', 0, used);
  } finally {
    fs.closeSync(fd);
  }
}

/** Determines whether this process has the libc required by bundled Kokoro. */
export function detectSpeechPlatform(probe: SpeechPlatformProbe): SpeechPlatformResult {
  if (probe.platform !== 'linux') return { supported: false, reason: 'host_platform' };
  if (probe.arch !== 'x64') return { supported: false, reason: 'host_arch' };
  let reportFailed = false;
  try {
    const report = probe.report();
    if (
      typeof report === 'object' &&
      report !== null &&
      'header' in report &&
      typeof report.header === 'object' &&
      report.header !== null &&
      'glibcVersionRuntime' in report.header &&
      typeof report.header.glibcVersionRuntime === 'string' &&
      /^\d+\.\d+(?:\.\d+)*$/.test(report.header.glibcVersionRuntime)
    ) {
      return { supported: true };
    }
  } catch {
    reportFailed = true;
  }
  try {
    const maps = probe.maps();
    const paths = maps.split('\n').flatMap((line) => {
      const match = /^[\da-f]+-[\da-f]+\s+[r-][w-][x-][ps]\s+[\da-f]+\s+[\da-f]+:[\da-f]+\s+\d+\s+(\/.*)$/.exec(line);
      return match?.[1] === undefined ? [] : [match[1]];
    });
    const libc = paths.filter((path) => /\/(?:libc\.so\.6|libc-2\.\d+(?:\.\d+)*\.so)$/.test(path));
    const loader = paths.filter((path) => /\/(?:ld-linux-x86-64\.so\.2|ld-2\.\d+(?:\.\d+)*\.so)$/.test(path));
    const musl = paths.some((path) => /\/(?:ld-musl-|libc\.musl-)[^/\s]+(?: \(deleted\))?$/.test(path));
    const deleted = paths.some((path) =>
      /\/(?:libc\.so\.6|libc-2\.\d+(?:\.\d+)*\.so|ld-linux-x86-64\.so\.2|ld-2\.\d+(?:\.\d+)*\.so) \(deleted\)$/.test(path),
    );
    if (!musl && !deleted && libc.length > 0 && loader.length > 0) {
      return { supported: true };
    }
  } catch {
    // Missing, truncated, or inaccessible process evidence remains unsupported.
  }
  return { supported: false, reason: reportFailed ? 'libc_report_failed' : 'libc_unknown' };
}

/** Uses only the current host and fixed local probes. */
export function localSpeechPlatform(): SpeechPlatformResult {
  // specs/SpeechPlatformEvidence.tla, Check: require positive current-process evidence.
  return detectSpeechPlatform({
    platform: process.platform,
    arch: process.arch,
    report: () => process.report?.getReport(),
    maps: processMaps,
  });
}
