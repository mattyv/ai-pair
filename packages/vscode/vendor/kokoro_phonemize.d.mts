/** Converts text to Kokoro-compatible phonemes using the bundled eSpeak data. */
export function phonemize(text: string, language?: 'a' | 'b', normalize?: boolean): Promise<string>;
