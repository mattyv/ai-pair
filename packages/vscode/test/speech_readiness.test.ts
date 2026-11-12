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

it('rejects readiness when output or local runtime disappears during a model check', async () => {
  const settings: SpeechSettings = {
    enabled: true,
    provider: 'kokoro',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
  };
  let output = true;
  let local = true;
  const options = {
    settings: () => settings,
    desktop: () => true,
    local: () => local,
    output: () => output,
    model: () => Promise.resolve(true),
    key: () => Promise.resolve(true),
  };
  const first = Promise.withResolvers<boolean>();
  const outputCheck = speechReady({ ...options, model: () => first.promise });
  output = false;
  first.resolve(true);
  expect(await outputCheck).toBe(false);
  output = true;
  const second = Promise.withResolvers<boolean>();
  const runtimeCheck = speechReady({ ...options, model: () => second.promise });
  local = false;
  second.resolve(true);
  expect(await runtimeCheck).toBe(false);
});

it('requires the selected OpenRouter model, voice, and its own credential', async () => {
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  };
  let requestedProvider = '';
  const options = {
    settings: () => settings,
    desktop: () => true,
    local: () => false,
    output: () => true,
    model: () => Promise.resolve(false),
    key: (provider: string) => {
      requestedProvider = provider;
      return Promise.resolve(true);
    },
  };
  expect(await speechReady(options)).toBe(true);
  expect(requestedProvider).toBe('openrouter');
  settings.openRouterModel = '';
  expect(await speechReady(options)).toBe(false);
  settings.openRouterModel = 'model';
  settings.openRouterVoice = '';
  expect(await speechReady(options)).toBe(false);
});

it('does not report OpenRouter ready without its key or saved selection', async () => {
  const settings = { enabled: true, provider: 'openrouter' as const, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
  const options = {
    settings: () => settings,
    desktop: () => true,
    local: () => false,
    output: () => true,
    model: () => Promise.resolve(false),
    key: () => Promise.resolve(false),
  };
  expect(await speechReady(options)).toBe(false);
  expect(await speechReady({ ...options, settings: () => ({ ...settings, openRouterModel: 'model' }) })).toBe(false);
  expect(await speechReady({ ...options, settings: () => ({ ...settings, openRouterModel: 'model', openRouterVoice: 'voice' }) })).toBe(
    false,
  );
});

it('blocks a saved OpenRouter pair excluded by the current account catalog', async () => {
  const options = {
    settings: () => ({
      enabled: true,
      provider: 'openrouter' as const,
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'model',
      openRouterVoice: 'voice',
    }),
    desktop: () => true,
    local: () => false,
    output: () => true,
    model: () => Promise.resolve(false),
    key: () => Promise.resolve(true),
    openRouterAllowed: (model: string, voice: string) => model === 'model' && voice !== 'voice',
  };
  expect(await speechReady(options)).toBe(false);
});

it('admits OpenRouter provider-default voice only when the catalog allows it', async () => {
  let allowed = true;
  const options = {
    settings: () => ({
      enabled: true,
      provider: 'openrouter' as const,
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'model',
      openRouterVoice: '',
    }),
    desktop: () => true,
    local: () => false,
    output: () => true,
    model: () => Promise.resolve(false),
    key: () => Promise.resolve(true),
    openRouterAllowed: (model: string, voice: string) => allowed && model === 'model' && voice === '',
  };
  expect(await speechReady(options)).toBe(true);
  allowed = false;
  expect(await speechReady(options)).toBe(false);
  expect(await speechReady({ ...options, openRouterAllowed: undefined })).toBe(false);

  allowed = true;
  const key = Promise.withResolvers<boolean>();
  const pending = speechReady({ ...options, key: () => key.promise });
  allowed = false;
  key.resolve(true);
  expect(await pending).toBe(false);
});

it('rejects readiness when catalog evidence changes while a key check is pending', async () => {
  let allowed = true;
  const key = Promise.withResolvers<boolean>();
  const options = {
    settings: () => ({
      enabled: true,
      provider: 'openrouter' as const,
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'model',
      openRouterVoice: 'voice',
    }),
    desktop: () => true,
    local: () => false,
    output: () => true,
    model: () => Promise.resolve(false),
    key: () => key.promise,
    openRouterAllowed: () => allowed,
  };
  expect(await speechReady({ ...options, key: () => Promise.resolve(true) })).toBe(true);
  const pending = speechReady(options);
  allowed = false;
  key.resolve(true);
  expect(await pending).toBe(false);
});
