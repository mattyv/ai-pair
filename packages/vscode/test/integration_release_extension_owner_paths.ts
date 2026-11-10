// Exercises real extension retirement and replacement in a dedicated VS Code host.
import * as assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';
import type { SpeechComputeState } from '../src/speech_compute_types';

interface ExtensionModule {
  activate(context: vscode.ExtensionContext): Api;
  deactivate(): Promise<void>;
}

/** Checks the CommonJS entry before wrapping its activation boundary. */
function isExtensionModule(value: unknown): value is ExtensionModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'activate' in value &&
    typeof value.activate === 'function' &&
    'deactivate' in value &&
    typeof value.deactivate === 'function'
  );
}

/** Disposes only the registrations belonging to one activation. */
function disposeAll(subscriptions: vscode.Disposable[]): void {
  for (const disposable of subscriptions.splice(0)) disposable.dispose();
}

/** Checks the delegated context's required host resources. */
function isContext(value: unknown): value is vscode.ExtensionContext {
  return typeof value === 'object' && value !== null && 'subscriptions' in value && 'globalState' in value && 'secrets' in value;
}

/** Delegates the real context while giving an activation its own disposable list. */
function scopedContext(context: vscode.ExtensionContext, subscriptions: vscode.Disposable[]): vscode.ExtensionContext {
  const scoped: unknown = new Proxy(
    {},
    {
      get(target, property): unknown {
        void target;
        return property === 'subscriptions' ? subscriptions : Reflect.get(context, property, context);
      },
      has(target, property): boolean {
        void target;
        return property === 'subscriptions' || Reflect.has(context, property);
      },
    },
  );
  assert.ok(isContext(scoped));
  return scoped;
}

/** Checks the extension-scoped VS Code API returned to the loaded entry. */
function isVsCode(value: unknown): value is typeof vscode {
  return typeof value === 'object' && value !== null && 'window' in value && typeof value.window === 'object' && value.window !== null;
}

/** Identifies the real panel's public compute-state delivery method. */
function isComputePanel(value: vscode.WebviewViewProvider): value is vscode.WebviewViewProvider & {
  showSpeechComputeState(state: SpeechComputeState): void;
} {
  return 'showSpeechComputeState' in value && typeof value.showSpeechComputeState === 'function';
}

/** Waits for a host state notification. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  assert.fail(`Timed out waiting for ${description}`);
}

/** Retires a real owner before activating a replacement with the same persisted state. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(extension && !extension.isActive, 'the extension must start inactive');
  const entry = path.join(extension.extensionPath, 'dist', 'extension.js');
  const requireEntry = createRequire(entry);
  const hostApi: unknown = requireEntry('vscode');
  assert.ok(isVsCode(hostApi), 'the extension-scoped VS Code API must be available');
  const loaded: unknown = requireEntry(entry);
  assert.ok(isExtensionModule(loaded), 'the installed entry must expose activate and deactivate');
  const cached = requireEntry.cache[requireEntry.resolve(entry)];
  assert.ok(cached, 'the installed entry must be cached');
  const originalExports: unknown = cached.exports;
  let actualContext: vscode.ExtensionContext | undefined;
  const firstSubscriptions: vscode.Disposable[] = [];
  cached.exports = {
    ...loaded,
    activate: (context: vscode.ExtensionContext): Api => {
      actualContext = context;
      const scoped = scopedContext(context, firstSubscriptions);
      return loaded.activate(scoped);
    },
  };
  const settings = vscode.workspace.getConfiguration('aiPair');
  const target = vscode.ConfigurationTarget.Global;
  const originalEnabled = settings.inspect<unknown>('speech.enabled')?.globalValue;
  const originalMode = settings.inspect<unknown>('speech.computeMode')?.globalValue;
  const secondSubscriptions: vscode.Disposable[] = [];
  const thirdSubscriptions: vscode.Disposable[] = [];
  let second: Api | undefined;
  let savedOutput: unknown;
  const registrationDescriptor = Object.getOwnPropertyDescriptor(hostApi.window, 'registerWebviewViewProvider');
  assert.ok(registrationDescriptor, 'VS Code must expose view registration');
  const register = hostApi.window.registerWebviewViewProvider.bind(hostApi.window);
  const computeStates: SpeechComputeState[] = [];
  let restorePanel: (() => void) | undefined;
  Object.defineProperty(hostApi.window, 'registerWebviewViewProvider', {
    ...registrationDescriptor,
    value: (id: string, provider: vscode.WebviewViewProvider, options?: { webviewOptions?: { retainContextWhenHidden?: boolean } }) => {
      if (id === 'aiPair.narration' && isComputePanel(provider)) {
        const original = provider.showSpeechComputeState.bind(provider);
        Object.defineProperty(provider, 'showSpeechComputeState', {
          configurable: true,
          value: (state: SpeechComputeState) => {
            computeStates.push(state);
            original(state);
          },
        });
        restorePanel = () => {
          Reflect.deleteProperty(provider, 'showSpeechComputeState');
        };
      }
      return register(id, provider, options);
    },
  });
  try {
    // Restore Auto while disabled, then choose CPU before requesting warmup.
    await settings.update('speech.enabled', false, target);
    await settings.update('speech.computeMode', 'auto', target);
    const first = await extension.activate();
    cached.exports = originalExports;
    assert.ok(actualContext, 'VS Code must provide its real extension context');
    savedOutput = actualContext.globalState.get('speechOutput');
    await first.ready;
    assert.ok(restorePanel, 'the real panel provider must be observed');
    computeStates.length = 0;
    await settings.update('speech.computeMode', 'gpu', target);
    await until(() => computeStates.some((state) => state.requestedMode === 'gpu'), 'the GPU preference to reach the lifecycle owner');
    computeStates.length = 0;
    await settings.update('speech.computeMode', 'auto', target);
    await until(() => computeStates.some((state) => state.requestedMode === 'auto'), 'the Auto preference to reach the lifecycle owner');
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.enabled'), false);
    restorePanel();
    restorePanel = undefined;
    Object.defineProperty(hostApi.window, 'registerWebviewViewProvider', registrationDescriptor);
    // CPU warmup can check the isolated profile's absent model but cannot download it.
    await settings.update('speech.computeMode', 'cpu', target);
    await settings.update('speech.enabled', true, target);
    await first.previewSpeech();
    assert.equal(first.speechStatus()?.state, 'unavailable');
    assert.equal(first.speechStatus()?.started, false);

    disposeAll(firstSubscriptions);
    await loaded.deactivate();
    await actualContext.globalState.update('speechOutput', { kind: 'native', backend: 'pipewire', name: 'missing-test-device' });
    const scoped = scopedContext(actualContext, secondSubscriptions);
    second = loaded.activate(scoped);
    await second.ready;
    await second.previewSpeech();
    assert.equal(second.speechStatus()?.state, 'unavailable');
    assert.equal(second.speechStatus()?.started, false);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.enabled'), true);
    // Command and view registration would throw if the first owner still held them.
    await vscode.commands.executeCommand('aiPair.copyDiagnostics');
    const report: unknown = JSON.parse(await vscode.env.clipboard.readText());
    assert.ok(report !== null && typeof report === 'object' && 'audio' in report);
    assert.ok(report.audio !== null && typeof report.audio === 'object' && 'output' in report.audio);
    assert.equal(report.audio.output, 'override');
    assert.ok('routeAvailable' in report.audio);
    assert.equal(report.audio.routeAvailable, false, 'the missing restored device must not be reported available');

    // Diagnostics remain callable during shutdown but must not claim stale readiness.
    await loaded.deactivate();
    await vscode.commands.executeCommand('aiPair.copyDiagnostics');
    const stoppedReport: unknown = JSON.parse(await vscode.env.clipboard.readText());
    assert.ok(stoppedReport !== null && typeof stoppedReport === 'object' && 'audio' in stoppedReport);
    assert.ok(stoppedReport.audio !== null && typeof stoppedReport.audio === 'object');
    assert.ok('routeAvailable' in stoppedReport.audio && 'runtimeReady' in stoppedReport.audio && 'modelReady' in stoppedReport.audio);
    assert.equal(stoppedReport.audio.routeAvailable, 'unknown');
    assert.equal(stoppedReport.audio.runtimeReady, 'unknown');
    assert.equal(stoppedReport.audio.modelReady, 'unknown');
    disposeAll(secondSubscriptions);

    // A replacement closed before placement must settle without registering a view.
    const descriptor = Object.getOwnPropertyDescriptor(hostApi.window, 'registerWebviewViewProvider');
    assert.ok(descriptor, 'VS Code must expose view registration');
    const registerReplacement = hostApi.window.registerWebviewViewProvider.bind(hostApi.window);
    let registered = 0;
    try {
      Object.defineProperty(hostApi.window, 'registerWebviewViewProvider', {
        ...descriptor,
        value: (...args: Parameters<typeof vscode.window.registerWebviewViewProvider>) => {
          registered++;
          return registerReplacement(...args);
        },
      });
      const third = loaded.activate(scopedContext(actualContext, thirdSubscriptions));
      await loaded.deactivate();
      await third.ready;
      assert.equal(registered, 0, 'a closed replacement registered a panel provider');
    } finally {
      Object.defineProperty(hostApi.window, 'registerWebviewViewProvider', descriptor);
    }
    console.log('retired legacy owner releases registrations before a warm replacement');
  } finally {
    cached.exports = originalExports;
    restorePanel?.();
    Object.defineProperty(hostApi.window, 'registerWebviewViewProvider', registrationDescriptor);
    second?.controller.endSession();
    disposeAll(firstSubscriptions);
    disposeAll(secondSubscriptions);
    disposeAll(thirdSubscriptions);
    await loaded.deactivate();
    if (actualContext !== undefined) await actualContext.globalState.update('speechOutput', savedOutput);
    await settings.update('speech.computeMode', originalMode, target);
    await settings.update('speech.enabled', originalEnabled, target);
  }
}
