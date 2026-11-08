import { expect, it } from 'vitest';
import { speechReady } from '../src/speech_readiness';
import type { SpeechSettings } from '../src/speech_types';

it('requires enabled, supported settings, output and installed local model', async () => {
  const settings: SpeechSettings = {
    enabled: true,
    provider: 'kokoro',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
  };
  const options = {
    settings: () => settings,
    desktop: () => true,
    local: () => true,
    output: () => true,
    model: () => Promise.resolve(true),
    key: () => Promise.resolve(true),
  };
  expect(await speechReady(options)).toBe(true);
  expect(await speechReady({ ...options, local: () => false })).toBe(false);
  settings.speed = 9;
  expect(await speechReady(options)).toBe(false);
  settings.speed = 1;
  settings.enabled = false;
  expect(await speechReady(options)).toBe(false);
  settings.enabled = true;
  expect(await speechReady({ ...options, output: () => false })).toBe(false);
  expect(await speechReady({ ...options, model: () => Promise.resolve(false) })).toBe(false);
});

it('checks cloud credentials and rejects stale settings after an asynchronous check', async () => {
  const settings: SpeechSettings = {
    enabled: true,
    provider: 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1,
  };
  const options = {
    settings: () => settings,
    desktop: () => true,
    local: () => false,
    output: () => true,
    model: () => Promise.resolve(false),
    key: () => Promise.resolve(true),
  };
  expect(await speechReady(options)).toBe(true);
  expect(await speechReady({ ...options, key: () => Promise.resolve(false) })).toBe(false);
  expect(await speechReady({ ...options, desktop: () => false })).toBe(false);
  settings.elevenLabsVoice = '';
  expect(await speechReady(options)).toBe(false);
  settings.elevenLabsVoice = 'voice';
  settings.elevenLabsSpeed = 9;
  expect(await speechReady(options)).toBe(false);
  settings.elevenLabsSpeed = 1;
  expect(
    await speechReady({
      ...options,
      key: () => {
        settings.enabled = false;
        return Promise.resolve(true);
      },
    }),
  ).toBe(false);
});
