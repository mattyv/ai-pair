import { verifyMappedGpuDriver } from './speech_gpu_driver_identity';
import { loadGpuSpeechEngine } from './speech_gpu_engine';
import { verifyMappedVulkanLoader } from './speech_gpu_loader';
import { attachGpuWorker } from './speech_gpu_worker_runtime';

attachGpuWorker(
  {
    on: (event, listener) => {
      if (event === 'message') process.on('message', listener);
      else process.on('disconnect', listener);
    },
    send: (message) => {
      if (process.send === undefined || !process.connected) throw new Error('GPU worker IPC is unavailable.');
      process.send(message);
    },
    close: () => {
      if (process.connected) process.disconnect();
    },
  },
  process.argv.slice(2),
  { load: loadGpuSpeechEngine, verify: verifyMappedVulkanLoader, verifyDriver: verifyMappedGpuDriver },
);
