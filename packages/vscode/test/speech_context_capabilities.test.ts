import { describe, expect, it } from 'vitest';
import { speechContextCapabilities } from '../src/speech_context_capabilities';

describe('speechContextCapabilities', () => {
  it('allows only verified model capabilities', () => {
    expect(speechContextCapabilities('openrouter', 'elevenlabs/eleven-v3')).toEqual({ tags: true, previousText: false });
    expect(speechContextCapabilities('openrouter', 'elevenlabs/eleven-v3-conversational')).toEqual({ tags: true, previousText: false });
    expect(speechContextCapabilities('openrouter', 'elevenlabs/eleven-v4')).toEqual({ tags: true, previousText: true });
    expect(speechContextCapabilities('openrouter', 'elevenlabs/eleven-v4-turbo')).toEqual({ tags: true, previousText: false });
    expect(speechContextCapabilities('openrouter', 'unknown')).toEqual({ tags: false, previousText: false });
    expect(speechContextCapabilities('elevenlabs', 'elevenlabs/eleven-v4')).toEqual({ tags: false, previousText: false });
  });
});
