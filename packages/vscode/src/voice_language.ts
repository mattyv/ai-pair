// The language an OpenRouter voice speaks, for its label in the voice list (#100; specs/VoiceLanguage.tla). OpenRouter
// lists each model's voices as bare IDs; a voice is named here only where its own provider's documentation says what
// its ID means. Anything else keeps its bare ID: a label never guesses.

/** Each scheme reads a voice ID one way, for the models of one provider. */
interface Scheme {
  /** The models whose voices follow it, by the start of their OpenRouter ID. */
  models: string;
  /** Returns the language tag (BCP 47) the ID names, if the scheme documents it. */
  language: (voice: string) => string | undefined;
}

/**
 * Microsoft MAI voices begin with their locale: `en-AU-Isla:MAI-Voice-2.1`.
 * Kokoro's first letter is its language (hexgrad/Kokoro-82M, VOICES.md): `af_heart` is American English.
 */
const MAI_LOCALE = /^([a-z]{2,3}-[A-Z]{2})-[^:]+:/;
const KOKORO_PREFIX = /^([a-z])[fm]_/;
const KOKORO_LANGUAGES: ReadonlyMap<string, string> = new Map([
  ['a', 'en-US'],
  ['b', 'en-GB'],
  ['e', 'es'],
  ['f', 'fr'],
  ['h', 'hi'],
  ['i', 'it'],
  ['j', 'ja'],
  ['p', 'pt-BR'],
  ['z', 'zh'],
]);

/** Voxtral's preset speakers and their locales (docs.mistral.ai, text-to-speech voices): `gb_jane_sad` is Jane. */
const VOXTRAL_SPEAKER = /^[a-z]{2}_([a-z]+)_[a-z]+$/;
const VOXTRAL_LANGUAGES: ReadonlyMap<string, string> = new Map([
  ['paul', 'en-US'],
  ['jane', 'en-GB'],
  ['oliver', 'en-GB'],
  ['marie', 'fr-FR'],
]);

/**
 * Deepgram's Aura-2 voices are `aura-2-<name>-<language>` (developers.deepgram.com, TTS models), and its English
 * voices each have a documented accent: American unless listed here.
 */
const DEEPGRAM_VOICE = /^aura-2-([a-z]+)-([a-z]{2})$/;
const DEEPGRAM_ENGLISH = 'en';
const DEEPGRAM_ACCENTS: ReadonlyMap<string, string> = new Map([
  ['amalthea', 'en-PH'],
  ['draco', 'en-GB'],
  ['hyperion', 'en-AU'],
  ['pandora', 'en-GB'],
  ['theia', 'en-AU'],
]);
/** The English Aura-2 voices Deepgram documents as American. */
const DEEPGRAM_AMERICAN: ReadonlySet<string> = new Set([
  'andromeda',
  'apollo',
  'arcas',
  'aries',
  'asteria',
  'athena',
  'atlas',
  'aurora',
  'callista',
  'cora',
  'cordelia',
  'delia',
  'electra',
  'harmonia',
  'helena',
  'hera',
  'hermes',
  'iris',
  'janus',
  'juno',
  'jupiter',
  'luna',
  'mars',
  'minerva',
  'neptune',
  'odysseus',
  'ophelia',
  'orion',
  'orpheus',
  'phoebe',
  'pluto',
  'saturn',
  'selene',
  'thalia',
  'vesta',
  'zeus',
]);

/** Returns the accent Deepgram documents for an English Aura-2 voice, or English alone for one it does not list. */
function deepgramEnglish(name: string): string {
  if (DEEPGRAM_AMERICAN.has(name)) return 'en-US';
  return DEEPGRAM_ACCENTS.get(name) ?? DEEPGRAM_ENGLISH;
}

/** The documented schemes, each for its own provider's models only. */
const SCHEMES: readonly Scheme[] = [
  { models: 'microsoft/mai-voice', language: (voice) => MAI_LOCALE.exec(voice)?.[1] },
  {
    models: 'hexgrad/kokoro',
    language: (voice) => {
      const letter = KOKORO_PREFIX.exec(voice)?.[1];
      return letter === undefined ? undefined : KOKORO_LANGUAGES.get(letter);
    },
  },
  {
    models: 'mistralai/voxtral',
    language: (voice) => {
      const speaker = VOXTRAL_SPEAKER.exec(voice)?.[1];
      return speaker === undefined ? undefined : VOXTRAL_LANGUAGES.get(speaker);
    },
  },
  {
    models: 'deepgram/aura-2',
    language: (voice) => {
      const match = DEEPGRAM_VOICE.exec(voice);
      if (match === null) return undefined;
      const [, name = '', language = ''] = match;
      return language === DEEPGRAM_ENGLISH ? deepgramEnglish(name) : language;
    },
  },
];

/** Names a language tag in English words: `en-AU` is Australian English. A tag it has no name for is given back. */
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });

/**
 * Returns the language tag a voice of `model` speaks, where its provider documents it; otherwise undefined
 * (specs/VoiceLanguage.tla, `Language`: NoGuess and Named).
 */
export function voiceLanguage(model: string, voice: string): string | undefined {
  // Only the voice's own provider's scheme reads it: another provider's ID may look alike and mean something else.
  const scheme = SCHEMES.find((candidate) => model.startsWith(candidate.models));
  return scheme?.language(voice);
}

/**
 * Returns the label of a voice of `model` in the voice list: its ID, then the language it speaks when its provider
 * documents it, as in `en-AU-Isla:MAI-Voice-2.1 (Australian English)` (specs/VoiceLanguage.tla, `Label`: KeepsId).
 */
export function voiceLabel(model: string, voice: string): string {
  const language = voiceLanguage(model, voice);
  if (language === undefined) return voice;
  // With fallback 'code', `of` always gives a string; its type allows undefined only for fallback 'none'.
  return `${voice} (${String(LANGUAGE_NAMES.of(language))})`;
}
