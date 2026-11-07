import { createHash } from 'node:crypto';

const BUILD_ID_LENGTH = 16;

/** A named, content-addressed input to the companion build. */
export interface CompanionBuildInput {
  name: string;
  content: string | Uint8Array;
}

/** Returns the short deterministic digest of the ordered build inputs. */
export function companionBuildIdentity(inputs: readonly CompanionBuildInput[]): string {
  const hash = createHash('sha256');
  for (const input of inputs) {
    const digest = createHash('sha256').update(input.content).digest();
    hash.update(`${input.name.length}:${input.name}:`);
    hash.update(digest);
  }
  return hash.digest('hex').slice(0, BUILD_ID_LENGTH);
}
