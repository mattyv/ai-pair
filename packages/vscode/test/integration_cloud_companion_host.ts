// Exercises the real companion speech host with local, synthetic boundaries.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { localSpeechReport } from '@ai-pair/protocol';
import { NativeAdapter } from '../../audio-native/src/native_adapter';
import { createSpeechHost } from '../../audio-ui/src/speech_host';
import { Diagnostics } from '../src/diagnostics';

/** Verifies the companion host records a bounded cloud failure. */
export async function cloudCompanionHost(): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-cloud-host-'));
  const changes = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
  // The host uses only these isolated storage and path operations in this fixture.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    extensionPath: '',
    globalStorageUri: vscode.Uri.file(directory),
    globalState: { get: () => undefined, update: () => Promise.resolve() },
    secrets: {
      get: () => Promise.resolve('synthetic-key'),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      onDidChange: changes.event,
    },
  } as unknown as vscode.ExtensionContext;
  const adapter = new NativeAdapter({
    capabilities: () =>
      Promise.resolve({ backend: 'fixture', location: 'ui', defaultOutput: true, deviceSelection: false, pauseResume: false }),
    defaultId: () => Promise.resolve('fixture'),
    list: () => Promise.resolve([{ id: 'fixture', label: 'Fixture' }]),
    start: () => {
      throw new Error('Unexpected playback');
    },
  });
  const diagnostics = new Diagnostics({ version: 'test', build: 'test' });
  const host = createSpeechHost({
    context,
    adapter,
    connectionEpoch: 'fixture',
    page: () => 1,
    panel: () => undefined,
    diagnostic: (event) => {
      diagnostics.record(event);
    },
  });
  try {
    for (let attempt = 0; attempt < 100 && !host.panelSpeech.outputReady(); attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    assert.equal(host.panelSpeech.outputReady(), true);
    await host.speech.speak('Private synthetic narration.');
    const snapshot = diagnostics.snapshot();
    const report = localSpeechReport.parse({ version: snapshot.version, build: snapshot.build, events: snapshot.events });
    assert.ok(
      report.events.some(
        (event) => event.event === 'narration' && event.provider === 'elevenlabs' && event.phase === 'failed' && event.reason === 'rate',
      ),
    );
    assert.doesNotMatch(JSON.stringify(report), /private|synthetic-key/i);
  } finally {
    host.dispose();
    changes.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
