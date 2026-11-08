import { parentPort } from 'node:worker_threads';
import { loadSpeechEngine } from './speech_engine';
import { SpeechWorkerHost } from './speech_worker_host';

if (parentPort === null) throw new Error('Speech worker requires a parent port.');
const port = parentPort;
const host = new SpeechWorkerHost(loadSpeechEngine, (message) => {
  port.postMessage(message);
});
port.on('message', (raw: unknown) => {
  void host.receive(raw);
});
