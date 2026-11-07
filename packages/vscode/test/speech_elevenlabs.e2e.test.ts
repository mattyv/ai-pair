import * as http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { ElevenLabsClient } from '../src/speech_elevenlabs';

let server: http.Server | undefined;
afterEach(async () => {
  const current = server;
  if (current !== undefined) {
    await new Promise<void>((resolve, reject) => {
      current.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
  server = undefined;
});

async function localClient(handler: http.RequestListener): Promise<ElevenLabsClient> {
  server = http.createServer(handler);
  const current = server;
  await new Promise<void>((resolve) => {
    current.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local server');
  const port = address.port;
  function localFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    const requested = new URL(input instanceof Request ? input.url : input);
    return fetch(`http://127.0.0.1:${port}${requested.pathname}${requested.search}`, init);
  }
  return new ElevenLabsClient(() => Promise.resolve('synthetic-key'), localFetch);
}

it('converts a real streamed PCM response to bounded playable WAV', async () => {
  const client = await localClient((request, response) => {
    expect(request.url).toBe('/v1/text-to-speech/voice?output_format=pcm_24000');
    expect(request.headers['xi-api-key']).toBe('synthetic-key');
    response.writeHead(200, { 'content-type': 'audio/pcm' });
    response.write(Buffer.from([0, 128]));
    response.end(Buffer.from([255, 127]));
  });
  const result = await client.synthesize({ text: 'Synthetic sample.', voiceId: 'voice', speed: 1 }, new AbortController().signal);
  expect(Buffer.from(result.wav).toString('ascii', 0, 4)).toBe('RIFF');
  expect(result.durationMs).toBeCloseTo(600 + (2 / 24_000) * 1000);
  expect(result.wav.length).toBe(44 + (2 + 14_400) * 2);
});

it('observes cancellation of an in-flight streamed request', async () => {
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const client = await localClient((request, response) => {
    void request;
    response.writeHead(200, { 'content-type': 'audio/pcm' });
    response.write(Buffer.from([1, 0]));
    opened.resolve();
    response.on('close', () => {
      closed.resolve();
    });
  });
  const controller = new AbortController();
  const result = client.synthesize({ text: 'Synthetic sample.', voiceId: 'voice', speed: 1 }, controller.signal);
  await opened.promise;
  controller.abort();
  await expect(result).rejects.toMatchObject({ kind: 'canceled' });
  await closed.promise;
});
