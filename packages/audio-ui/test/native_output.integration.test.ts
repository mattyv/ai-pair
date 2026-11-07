import { expect, it, vi } from 'vitest';
import { NativeAdapter } from '../../audio-native/src/native_adapter';
import { CompanionOutput } from '../src/companion_output';

it('delivers the real adapter first started event to the speech output', async () => {
  const closed = Promise.withResolvers<void>();
  const backend = {
    list: () => Promise.resolve([{ id: 'selected', label: 'Synthetic output' }]),
    start: (route: string, wav: Uint8Array, event: (type: 'started' | 'ended' | 'canceled' | 'failed') => void) => {
      expect(route).toBe('selected');
      expect(wav.byteLength).toBe(44);
      event('started');
      return {
        stop: () => {
          closed.resolve();
        },
        closed: closed.promise,
      };
    },
  };
  const adapter = new NativeAdapter(backend);
  const event = vi.fn<(value: import('../../vscode/src/speech_service').SpeechAudioEvent) => void>();
  const output = new CompanionOutput({
    adapter,
    connectionEpoch: 'epoch',
    page: () => 1,
    choice: () => ({ kind: 'device', id: 'selected' }),
    ready: () => true,
    event,
    status: vi.fn<import('../../vscode/src/speech_service').SpeechOutput['status']>(),
  });
  expect(await output.prepare(1)).toBe(true);
  expect(output.play(1, new Uint8Array(44))).toBe(1);
  await vi.waitFor(() => {
    expect(event).toHaveBeenCalledWith({ id: 1, pageId: 1, event: 'started' });
  });
  output.cancel(1);
  await output.stopAndWait();
  output.dispose();
});
