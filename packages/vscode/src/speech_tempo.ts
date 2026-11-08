/** Experimental listening-rate candidates, pending speech-quality validation. */
// The discrete values are the offered-rate list.
// oxlint-disable-next-line eslint/no-magic-numbers
export const SPEECH_LISTENING_RATES = [0.75, 1, 1.25, 1.5] as const;
/** A discrete playback tempo, independent of the provider's synthesis rate. */
export type SpeechTempoRate = (typeof SPEECH_LISTENING_RATES)[number];

const SAMPLE_RATE = 24_000;
const MAX_AUDIO_SECONDS = 40;
const FRAME = 1024;
const OVERLAP = 256;
/** Inputs shorter than this remain within one window of every target length. */
const SHORT_INPUT_SAMPLES = 3072;
const HOP = FRAME - OVERLAP;
const SEARCH = 192;
const TRANSIENT_MIN = 1000;
const TRANSIENT_RATIO = 4;
const PCM_MIN = -32_768;
const PCM_MAX = 32_767;

/** Chooses a nearby source frame with the best normalized overlap. */
function findOverlap(input: Int16Array, output: Int16Array, destination: number, expected: number): number {
  const maximum = input.length - FRAME;
  const center = Math.min(maximum, Math.max(0, expected));
  const first = Math.max(0, center - SEARCH);
  const last = Math.min(maximum, center + SEARCH);
  let best = center;
  let bestScore = -Infinity;
  for (let candidate = first; candidate <= last; candidate++) {
    let dot = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (const [offset, right] of input.subarray(candidate, candidate + OVERLAP).entries()) {
      // The candidate overlap lies wholly inside the allocated output.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const left = output[destination + offset]!;
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    const score = denominator === 0 ? 0 : dot / denominator;
    if (score > bestScore || (score === bestScore && Math.abs(candidate - center) < Math.abs(best - center))) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Finds an isolated transient that a skipped source gap would otherwise lose. */
function gapTransient(input: Int16Array, from: number, to: number): number | undefined {
  for (const [offset, sample] of input.subarray(from, to).entries()) {
    const index = from + offset;
    // Gaps are inside complete source frames and have both neighboring samples.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const neighbors = Math.max(Math.abs(input[index - 1]!), Math.abs(input[index + 1]!));
    if (Math.abs(sample) >= TRANSIENT_MIN && Math.abs(sample) > TRANSIENT_RATIO * neighbors) return index;
  }
  return undefined;
}

/** Places one source frame at a destination, crossfading its head into the existing output. */
function copyFrame(input: Int16Array, output: Int16Array, source: number, destination: number): void {
  for (const [index, sample] of input.subarray(source, source + FRAME).entries()) {
    if (index < OVERLAP) {
      const mix = index / OVERLAP;
      // Each source frame is placed wholly inside the allocated output.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const blended = output[destination + index]! * (1 - mix) + sample * mix;
      output[destination + index] = Math.max(PCM_MIN, Math.min(PCM_MAX, Math.round(blended)));
    } else {
      output[destination + index] = sample;
    }
  }
}

/** Changes PCM duration using overlap alignment while preserving the source pitch. */
export function stretchSpeechPcm(input: Int16Array, rate: SpeechTempoRate): Int16Array {
  if (input.length > SAMPLE_RATE * MAX_AUDIO_SECONDS) throw new Error('Speech transform input is invalid.');
  // Keeping short fragments intact preserves transients within one window of target.
  if (rate === 1 || input.length < SHORT_INPUT_SAMPLES) return input.slice();
  const length = Math.round(input.length / rate);
  if (length > SAMPLE_RATE * MAX_AUDIO_SECONDS) throw new Error('Speech transform output is too long.');
  const output = new Int16Array(length);
  output.set(input.subarray(0, FRAME));
  let sourceEnd = FRAME;
  let outputEnd = FRAME;
  let lastDestination = 0;
  const finalStart = length - FRAME;
  for (let destination = HOP; destination < finalStart; destination += HOP) {
    let source = findOverlap(input, output, destination, Math.round(destination * rate));
    const transient = gapTransient(input, sourceEnd, source);
    if (transient !== undefined) source = Math.max(0, transient - OVERLAP);
    sourceEnd = Math.max(sourceEnd, source + FRAME);
    outputEnd = destination + FRAME;
    copyFrame(input, output, source, destination);
    lastDestination = destination;
  }
  // The gap before the anchored final frame has no aligned frame of its own: re-place the last
  // frame around an isolated transient there so the anchor cannot erase it.
  const finalTransient = gapTransient(input, sourceEnd, input.length - FRAME);
  if (finalTransient !== undefined) copyFrame(input, output, Math.max(0, finalTransient - OVERLAP), lastDestination);
  // Anchor the final source frame at the output end and blend the complete
  // overlap with the preceding frame; never append samples beyond the bound.
  const overlap = Math.max(0, outputEnd - finalStart);
  for (const [index, sample] of input.subarray(input.length - FRAME).entries()) {
    if (index < overlap) {
      const mix = index / overlap;
      // The final frame exactly occupies the last FRAME output samples.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      output[finalStart + index] = Math.round(output[finalStart + index]! * (1 - mix) + sample * mix);
    } else {
      output[finalStart + index] = sample;
    }
  }
  return output;
}
