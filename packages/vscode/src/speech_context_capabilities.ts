/** Returns only capabilities verified for the selected provider and model. */
export function speechContextCapabilities(provider: string, model: string): { tags: boolean; previousText: boolean } {
  const tags =
    provider === 'openrouter' &&
    new Set(['elevenlabs/eleven-v3', 'elevenlabs/eleven-v3-conversational', 'elevenlabs/eleven-v4', 'elevenlabs/eleven-v4-turbo']).has(
      model,
    );
  return { tags, previousText: provider === 'openrouter' && model === 'elevenlabs/eleven-v4' };
}
