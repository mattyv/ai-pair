import { parentPort } from 'node:worker_threads';
import { runTempoRequest } from './speech_tempo_worker_host';

const port = parentPort;
if (port === null) throw new Error('Tempo worker requires a parent.');
port.on('message', (value: unknown) => {
  const response = runTempoRequest(value);
  if (response === undefined) {
    port.close();
    return;
  }
  if (response.type === 'result') port.postMessage(response, [response.pcm.buffer]);
  else port.postMessage(response);
});
