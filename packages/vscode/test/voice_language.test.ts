// The language an OpenRouter voice's label names (#100, specs/VoiceLanguage.tla). Solitary: voice_language.ts is pure,
// and Intl.DisplayNames is the runtime's own computation.

import { describe, expect, it } from 'vitest';
import { voiceLabel, voiceLanguage } from '../src/voice_language';

/** The voices each documented provider lists on OpenRouter (read 2026-11-16), and what their docs say they speak. */
const DOCUMENTED: ReadonlyArray<readonly [model: string, voice: string, language: string]> = [
  ['microsoft/mai-voice-2.1', 'en-AU-Isla:MAI-Voice-2.1', 'en-AU'],
  ['microsoft/mai-voice-2.1-flash', 'hi-IN-Kavya:MAI-Voice-2.1-Flash', 'hi-IN'],
  ['hexgrad/kokoro-82m', 'af_heart', 'en-US'],
  ['hexgrad/kokoro-82m', 'bm_george', 'en-GB'],
  ['hexgrad/kokoro-82m', 'ef_dora', 'es'],
  ['hexgrad/kokoro-82m', 'ff_siwis', 'fr'],
  ['hexgrad/kokoro-82m', 'hm_omega', 'hi'],
  ['hexgrad/kokoro-82m', 'if_sara', 'it'],
  ['hexgrad/kokoro-82m', 'jf_alpha', 'ja'],
  ['hexgrad/kokoro-82m', 'pm_alex', 'pt-BR'],
  ['hexgrad/kokoro-82m', 'zm_yunxi', 'zh'],
  ['mistralai/voxtral-mini-tts-2603', 'en_paul_neutral', 'en-US'],
  ['mistralai/voxtral-mini-tts-3-0', 'gb_jane_sad', 'en-GB'],
  ['mistralai/voxtral-mini-tts-2603', 'gb_oliver_curious', 'en-GB'],
  ['mistralai/voxtral-mini-tts-2603', 'fr_marie_happy', 'fr-FR'],
  ['deepgram/aura-2', 'aura-2-thalia-en', 'en-US'],
  ['deepgram/aura-2', 'aura-2-hyperion-en', 'en-AU'],
  ['deepgram/aura-2', 'aura-2-theia-en', 'en-AU'],
  ['deepgram/aura-2', 'aura-2-draco-en', 'en-GB'],
  ['deepgram/aura-2', 'aura-2-pandora-en', 'en-GB'],
  ['deepgram/aura-2', 'aura-2-amalthea-en', 'en-PH'],
  ['deepgram/aura-2', 'aura-2-agathe-fr', 'fr'],
  ['deepgram/aura-2', 'aura-2-julius-de', 'de'],
];

describe('voiceLanguage', () => {
  it.each(DOCUMENTED)('Named: names the language %s documents for %s', (model, voice, language) => {
    expect(voiceLanguage(model, voice)).toBe(language);
  });

  it('Named: names an English Aura-2 voice Deepgram has not listed as English alone, its documented suffix', () => {
    expect(voiceLanguage('deepgram/aura-2', 'aura-2-newcomer-en')).toBe('en');
  });

  it.each([
    // ElevenLabs documents no accent for its shared voices.
    ['elevenlabs/eleven-v3', 'charlie'],
    // Documented providers, with IDs outside their scheme or table.
    ['microsoft/mai-voice-2.1', 'Harper'],
    ['hexgrad/kokoro-82m', 'xf_unknown'],
    ['hexgrad/kokoro-82m', 'heart'],
    ['mistralai/voxtral-mini-tts-3-0', 'voice_478'],
    ['mistralai/voxtral-mini-tts-2603', 'en_someone_neutral'],
    ['deepgram/aura-2', 'aura-thalia-en'],
    // Deepgram's Flux voices look alike, but their naming is not the one documented for Aura-2.
    ['deepgram/flux-tts', 'flux-bree-en'],
  ])('NoGuess: names no language for %s voice %s', (model, voice) => {
    expect(voiceLanguage(model, voice)).toBeUndefined();
  });

  it("NoGuess: reads a voice only by its own provider's scheme", () => {
    // Each documented ID, under another provider's model, says nothing.
    for (const [model, voice] of DOCUMENTED) {
      for (const [other] of DOCUMENTED) {
        if (other.split('/')[0] !== model.split('/')[0]) {
          expect(voiceLanguage(other, voice)).toBeUndefined();
        }
      }
    }
  });
});

describe('voiceLabel', () => {
  it('KeepsId: shows the ID, then the language in words', () => {
    expect(voiceLabel('microsoft/mai-voice-2.1', 'en-AU-Isla:MAI-Voice-2.1')).toBe('en-AU-Isla:MAI-Voice-2.1 (Australian English)');
    expect(voiceLabel('hexgrad/kokoro-82m', 'bf_emma')).toBe('bf_emma (British English)');
    expect(voiceLabel('hexgrad/kokoro-82m', 'pf_dora')).toBe('pf_dora (Brazilian Portuguese)');
    expect(voiceLabel('deepgram/aura-2', 'aura-2-amalthea-en')).toBe('aura-2-amalthea-en (English (Philippines))');
  });

  it('KeepsId: leaves a voice with no documented language as its bare ID', () => {
    expect(voiceLabel('elevenlabs/eleven-v3', 'charlie')).toBe('charlie');
  });
});
