import { describe, expect, it } from 'vitest';
import { stretchSpeechPcm } from '../src/speech_tempo';

const SAMPLE_RATE = 24_000;
/** Produces a deterministic voiced tone without accessing an audio device. */
function tone(hertz: number, length: number): Int16Array {
  return Int16Array.from({ length }, (_, index) => Math.round(12_000 * Math.sin((2 * Math.PI * hertz * index) / SAMPLE_RATE)));
}

/** Estimates pitch from rising zero crossings in the interior of a buffer. */
function frequency(samples: Int16Array): number {
  let crossings = 0;
  for (let index = 1; index < samples.length; index++) {
    if ((samples[index - 1] ?? 0) <= 0 && (samples[index] ?? 0) > 0) crossings++;
  }
  return (crossings * SAMPLE_RATE) / samples.length;
}

describe('stretchSpeechPcm', () => {
  it('preserves the original samples exactly at 1.0 without aliasing them', () => {
    const input = tone(220, 2000);
    const result = stretchSpeechPcm(input, 1);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it.each([0.75, 1.25, 1.5] as const)('changes duration while preserving a voiced tone at rate %s', (rate) => {
    const input = tone(220, SAMPLE_RATE);
    const original = input.slice();
    const result = stretchSpeechPcm(input, rate);
    expect(Math.abs(result.length - input.length / rate)).toBeLessThanOrEqual(1024);
    expect(Math.abs(frequency(result) - 220)).toBeLessThan(8);
    expect(input).toEqual(original);
  });

  it('handles short, silent and impulse inputs without non-finite or out-of-range samples', () => {
    for (const input of [new Int16Array(), new Int16Array([0]), new Int16Array(128), Int16Array.from([0, 32_767, 0])]) {
      const result = stretchSpeechPcm(input, 0.75);
      expect(Array.from(result).every((sample) => Number.isFinite(sample) && sample >= -32_768 && sample <= 32_767)).toBe(true);
    }
  });

  it('retains nonempty short words and impulses with bounded output length', () => {
    for (const input of [Int16Array.from([0, 32_767, 0]), tone(220, 240)]) {
      const result = stretchSpeechPcm(input, 0.75);
      expect(result.length).toBeGreaterThan(0);
      expect(Math.abs(result.length - input.length / 0.75)).toBeLessThanOrEqual(1024);
      expect(Array.from(result).some((sample) => sample !== 0)).toBe(true);
    }
  });
});

it('does not drop a short impulse when speeding up', () => {
  const input = Int16Array.from([0, 0, 32_767]);
  const result = stretchSpeechPcm(input, 1.5);
  expect(result.length).toBeGreaterThan(0);
  expect(Array.from(result).some((sample) => sample !== 0)).toBe(true);
});

it('bounds input and output before allocating and handles long silence', () => {
  expect(() => stretchSpeechPcm(new Int16Array(960_001), 1)).toThrow('input is invalid');
  expect(() => stretchSpeechPcm(new Int16Array(800_000), 0.75)).toThrow('output is too long');
  expect(Array.from(stretchSpeechPcm(new Int16Array(3000), 1.5)).every((sample) => sample === 0)).toBe(true);
  expect(Math.abs(stretchSpeechPcm(tone(220, 1025), 1.25).length - 820)).toBeLessThanOrEqual(1024);
});

it.each([0.75, 1.25, 1.5] as const)('retains an ending transient at rate %s without extending the duration', (rate) => {
  const input = new Int16Array(24_000);
  input[input.length - 1] = 12_000;
  const output = stretchSpeechPcm(input, rate);
  expect(output.length).toBe(Math.round(input.length / rate));
  expect(output.at(-1)).toBe(12_000);
});

it.each([0.75, 1.25, 1.5] as const)('retains isolated short-fragment transients at rate %s', (rate) => {
  for (const index of [0, 240, 767, 1023, 1199]) {
    const input = new Int16Array(1200);
    input[index] = 12_000;
    const output = stretchSpeechPcm(input, rate);
    expect(Math.abs(output.length - input.length / rate)).toBeLessThanOrEqual(1024);
    expect(output.some((sample) => sample !== 0)).toBe(true);
  }
});

it.each([1023, 1024, 1025] as const)('retains both ends around the alignment-window boundary of %s samples', (length) => {
  const input = new Int16Array(length);
  input[0] = 10_000;
  input[length - 1] = 12_000;
  for (const rate of [0.75, 1.25, 1.5] as const) {
    const output = stretchSpeechPcm(input, rate);
    expect(output[0]).toBe(10_000);
    expect(output.at(-1)).toBe(12_000);
    expect(Math.abs(output.length - input.length / rate)).toBeLessThanOrEqual(1024);
  }
});

it.each([0.75, 1.25, 1.5] as const)('retains isolated transients throughout a long waveform at rate %s', (rate) => {
  for (const index of [0, 3000, 6000, 12_000, 18_000, 23_999]) {
    const input = new Int16Array(24_000);
    input[index] = 12_000;
    const output = stretchSpeechPcm(input, rate);
    expect(output.some((sample) => sample !== 0)).toBe(true);
  }
});

it.each([4500, 8000, 11_500, 16_000, 19_500])('retains a transient in a compressed overlap gap at sample %s', (index) => {
  const input = new Int16Array(24_000);
  input[index] = 12_000;
  const output = stretchSpeechPcm(input, 1.5);
  expect(output.some((sample) => sample !== 0)).toBe(true);
  expect(output.length).toBe(16_000);
});

describe('isolated impulses on the stretch path', () => {
  const IMPULSE = 12_000;
  const SWEEP_STEP = 211;
  const DENSE_TAIL = 400;
  // The macOS Intel runner took 74 s for one sweep under coverage (#39).
  const SWEEP_TIMEOUT_MS = 180_000;
  // No impulse of a long silent waveform may be erased, including the gap between the
  // last aligned frame and the anchored final frame. Crossfades may attenuate it.
  it.each([
    [24_000, 0.75],
    [24_000, 1.5],
    [23_977, 1.5],
    [30_001, 1.25],
  ] as const)(
    'keeps every impulse of a %s sample waveform at rate %s',
    (length, rate) => {
      const lost: number[] = [];
      for (let index = 0; index < length; index += index < length - DENSE_TAIL ? SWEEP_STEP : 1) {
        const input = new Int16Array(length);
        input[index] = IMPULSE;
        const peak = Math.max(...Array.from(stretchSpeechPcm(input, rate), Math.abs));
        if (peak === 0) lost.push(index);
      }
      expect(lost).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );

  it('keeps an impulse in the gap before the anchored final frame at nearly full level', () => {
    const input = new Int16Array(24_000);
    input[22_940] = IMPULSE;
    const peak = Math.max(...Array.from(stretchSpeechPcm(input, 1.5), Math.abs));
    expect(peak).toBeGreaterThanOrEqual(IMPULSE * 0.75);
  });
});

describe('stretch path properties', () => {
  it.each([0.75, 1.25, 1.5] as const)('keeps a sustained tone in range and exact in length at rate %s', (rate) => {
    const input = tone(220, 4800);
    const output = stretchSpeechPcm(input, rate);
    expect(output.length).toBe(Math.round(4800 / rate));
    expect(output.some((sample) => sample !== 0)).toBe(true);
    expect(Math.max(...Array.from(output, Math.abs))).toBeLessThanOrEqual(12_000);
  });

  it('stretches long silence to silence of the expected length', () => {
    const output = stretchSpeechPcm(new Int16Array(4000), 1.5);
    expect(output.length).toBe(2667);
    expect(output.every((sample) => sample === 0)).toBe(true);
  });

  it('returns an owned copy of input at the bypass threshold', () => {
    const input = tone(220, 3071);
    const output = stretchSpeechPcm(input, 1.5);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
