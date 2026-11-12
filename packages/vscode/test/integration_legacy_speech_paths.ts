// Exercises the legacy speech panel with an isolated profile and no credentials or audio server.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Api } from '../src/extension';

const speechEventSchema = z.object({
  kind: z.literal('speech'),
  seq: z.number(),
  event: z.string(),
  phase: z.string(),
  provider: z.string(),
  reason: z.string().optional(),
});
const reportSchema = z.object({ events: z.array(z.looseObject({ kind: z.string() })) });

/** Waits for an observable asynchronous effect. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  assert.fail(`Timed out waiting for ${description}`);
}

/** Copies the real extension diagnostics and returns their speech events. */
async function events(api: Api): Promise<Array<z.infer<typeof speechEventSchema>>> {
  await vscode.env.clipboard.writeText('');
  api.panelMessage({ type: 'copyDiagnostics' });
  let copied = '';
  for (let attempt = 0; attempt < 100 && copied === ''; attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    copied = await vscode.env.clipboard.readText();
  }
  const report = reportSchema.parse(JSON.parse(copied));
  return report.events.filter((event) => event.kind === 'speech').map((event) => speechEventSchema.parse(event));
}

/** Returns the newest retained speech event sequence, or zero when none exists. */
function latest(speechEvents: Array<z.infer<typeof speechEventSchema>>): number {
  return Math.max(0, ...speechEvents.map((event) => event.seq));
}

/** Verifies legacy speech settings, catalog, and credential callbacks in the extension host. */
export async function runLegacySpeechPaths(api: Api): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const keys = [
    'speech.enabled',
    'speech.listeningSpeed',
    'speech.voice',
    'speech.speed',
    'speech.provider',
    'speech.elevenLabsVoice',
    'speech.elevenLabsSpeed',
  ];
  const original = keys.map((key) => settings.inspect<unknown>(key)?.globalValue);
  const value = { enabled: false, voice: 'af_heart', speed: 1, provider: 'kokoro', elevenLabsVoice: '', elevenLabsSpeed: 1 };
  try {
    // The profile is isolated; removal establishes that loading the catalog cannot call the cloud.
    api.panelMessage({ type: 'speechKeyRemove' });
    await until(
      () => vscode.workspace.getConfiguration('aiPair').get('speech.elevenLabsVoice') === '',
      'the removed key to clear its voice',
    );
    api.panelMessage({ type: 'speechOutputRefresh' });
    api.panelMessage({ type: 'speechSettings', value: { ...value, provider: 'elevenlabs' } });
    await until(() => vscode.workspace.getConfiguration('aiPair').get('speech.provider') === 'elevenlabs', 'the cloud provider setting');
    function noKey(event: z.infer<typeof speechEventSchema>): boolean {
      return event.event === 'catalog' && event.provider === 'elevenlabs' && event.reason === 'no_key';
    }
    const previousSequence = latest(await events(api));
    api.panelMessage({ type: 'speechVoicesLoad' });
    let observed = false;
    for (let attempt = 0; attempt < 50 && !observed; attempt++) {
      observed = (await events(api)).some((event) => event.seq > previousSequence && noKey(event));
    }
    assert.ok(observed, 'the cloud catalog did not report the absent key');

    // Consecutive panel changes must persist the latest provider and speed.
    api.panelMessage({ type: 'speechSettings', value: { ...value, enabled: true, provider: 'elevenlabs' } });
    await until(() => vscode.workspace.getConfiguration('aiPair').get('speech.enabled') === true, 'the enabled setting');
    api.panelMessage({ type: 'speechSettings', value: { ...value, speed: 1.25 } });
    await until(
      () =>
        vscode.workspace.getConfiguration('aiPair').get('speech.provider') === 'kokoro' &&
        vscode.workspace.getConfiguration('aiPair').get('speech.enabled') === false &&
        vscode.workspace.getConfiguration('aiPair').get('speech.speed') === 1.25,
      'the latest provider and enabled settings',
    );
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.voice'), 'af_heart');
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.speed'), 1.25);

    // specs/ProviderChoice.tla, Success and KeyChange, made deterministic (#46): the first of two saves posted
    // back to back settles after the second began, so it must not replace the newer choice; and a voice named
    // after the key was removed is checked against the catalog, which is empty, so it is not restored.
    api.panelMessage({ type: 'speechSettings', value: { ...value, speed: 1.5, elevenLabsVoice: 'removed_voice' } });
    api.panelMessage({ type: 'speechSettings', value: { ...value, speed: 0.75 } });
    await until(() => vscode.workspace.getConfiguration('aiPair').get('speech.speed') === 0.75, 'the later of two overlapping saves');
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.elevenLabsVoice'), '');

    // Linux uses an isolated application store and the basic password backend.
    // The dummy prompt input never reaches a catalog, preview, or cloud request.
    if (process.platform === 'linux') {
      const descriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showInputBox');
      assert.ok(descriptor, 'VS Code did not expose showInputBox');
      function capability(phase: string, reason?: string) {
        return (event: z.infer<typeof speechEventSchema>): boolean =>
          event.event === 'capability' && event.provider === 'elevenlabs' && event.phase === phase && event.reason === reason;
      }
      const initialEvents = await events(api);
      const readyBefore = latest(initialEvents);
      let absentBefore = readyBefore;
      try {
        Object.defineProperty(vscode.window, 'showInputBox', {
          ...descriptor,
          value: () => Promise.resolve('ai-pair-integration-dummy-key'),
        });
        api.panelMessage({ type: 'speechKeySet' });
        let ready = false;
        for (let attempt = 0; attempt < 50 && !ready; attempt++) {
          ready = (await events(api)).some((event) => event.seq > readyBefore && capability('ready')(event));
        }
        assert.ok(ready, 'the dummy key did not report readiness');
        absentBefore = latest(await events(api));
      } finally {
        Object.defineProperty(vscode.window, 'showInputBox', descriptor);
        api.panelMessage({ type: 'speechKeyRemove' });
        let absent = false;
        for (let attempt = 0; attempt < 50 && !absent; attempt++) {
          absent = (await events(api)).some((event) => event.seq > absentBefore && capability('blocked', 'no_key')(event));
        }
        assert.ok(absent, 'removing the dummy key did not report no_key');
      }
      assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.elevenLabsVoice'), '');
    }

    // The final field of this distinct save is written after every earlier queued
    // save, including the settings update triggered by credential removal.
    api.panelMessage({ type: 'speechSettings', value: { ...value, elevenLabsSpeed: 1.2 } });
    await until(
      () => vscode.workspace.getConfiguration('aiPair').get('speech.elevenLabsSpeed') === 1.2,
      'the last field of the settings barrier',
    );

    // Reject one real configuration update at the VS Code boundary. All other
    // configuration operations and the error notification remain real.
    const configurationDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
    const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
    assert.ok(configurationDescriptor && errorDescriptor, 'VS Code framework methods are unavailable');
    const getConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
    const showError = vscode.window.showErrorMessage.bind(vscode.window);
    let rejected = false;
    let errors = 0;
    try {
      Object.defineProperty(vscode.window, 'showErrorMessage', {
        ...errorDescriptor,
        value: (...args: unknown[]) => {
          if (args[0] === 'Could not save speech settings.') errors++;
          const result: unknown = Reflect.apply(showError, undefined, args);
          return result;
        },
      });
      Object.defineProperty(vscode.workspace, 'getConfiguration', {
        ...configurationDescriptor,
        value: (section?: string, scope?: vscode.ConfigurationScope) => {
          const real = getConfiguration(section, scope);
          if (section !== 'aiPair') return real;
          return new Proxy(
            {},
            {
              get(target, key) {
                void target;
                if (key === 'update') {
                  return (...args: unknown[]) => {
                    if (args[0] === 'speech.enabled' && args[1] === true && !rejected) {
                      rejected = true;
                      return Promise.reject(new Error('injected configuration failure'));
                    }
                    const update: unknown = Reflect.get(real, key);
                    assert.ok(typeof update === 'function');
                    const result: unknown = Reflect.apply(update, real, args);
                    return result;
                  };
                }
                const member: unknown = Reflect.get(real, key);
                if (typeof member === 'function') {
                  const bound: unknown = member.bind(real);
                  return bound;
                }
                return member;
              },
            },
          );
        },
      });
      api.panelMessage({ type: 'speechSettings', value: { ...value, enabled: true } });
      await until(() => errors > 0, 'the real speech settings error notification');
      assert.ok(rejected, 'the targeted configuration update was not rejected');
      assert.equal(getConfiguration('aiPair').get('speech.enabled'), false);
    } finally {
      Object.defineProperty(vscode.workspace, 'getConfiguration', configurationDescriptor);
      Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
    }
    api.panelMessage({ type: 'speechSettings', value });
    await until(() => getConfiguration('aiPair').get('speech.speed') === 1, 'settings persistence after failure');

    // A failed older write must not roll back or report over a newer choice.
    let entered = false;
    let rejectOld: ((reason?: unknown) => void) | undefined;
    const deferred = new Promise<void>((resolve, reject) => {
      void resolve;
      rejectOld = reject;
    });
    let staleErrors = 0;
    try {
      Object.defineProperty(vscode.window, 'showErrorMessage', {
        ...errorDescriptor,
        value: (...args: unknown[]) => {
          if (args[0] === 'Could not save speech settings.') staleErrors++;
          const result: unknown = Reflect.apply(showError, undefined, args);
          return result;
        },
      });
      Object.defineProperty(vscode.workspace, 'getConfiguration', {
        ...configurationDescriptor,
        value: (section?: string, scope?: vscode.ConfigurationScope) => {
          const real = getConfiguration(section, scope);
          if (section !== 'aiPair') return real;
          return new Proxy(
            {},
            {
              get(target, key) {
                void target;
                const member: unknown = Reflect.get(real, key);
                if (key === 'update' && typeof member === 'function') {
                  return (...args: unknown[]) => {
                    if (!entered && args[0] === 'speech.enabled' && args[1] === true) {
                      entered = true;
                      return deferred;
                    }
                    const result: unknown = Reflect.apply(member, real, args);
                    return result;
                  };
                }
                if (typeof member === 'function') {
                  const bound: unknown = member.bind(real);
                  return bound;
                }
                return member;
              },
            },
          );
        },
      });
      api.panelMessage({ type: 'speechSettings', value: { ...value, enabled: true } });
      await until(() => entered, 'the delayed settings write');
      api.panelMessage({ type: 'speechSettings', value: { ...value, speed: 1.25 } });
      assert.ok(rejectOld);
      rejectOld(new Error('injected stale settings failure'));
      await until(() => getConfiguration('aiPair').get('speech.speed') === 1.25, 'the newer settings choice');
      assert.equal(getConfiguration('aiPair').get('speech.enabled'), false);
      assert.equal(staleErrors, 0, 'an obsolete failure was reported');
    } finally {
      if (entered) rejectOld?.(new Error('cancel delayed settings write'));
      Object.defineProperty(vscode.workspace, 'getConfiguration', configurationDescriptor);
      Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
    }

    // Dismiss the real native password prompt; no credential is entered.
    api.panelMessage({ type: 'speechKeySet' });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  } finally {
    for (const [index, key] of keys.entries()) await settings.update(key, original[index], global);
  }
}
