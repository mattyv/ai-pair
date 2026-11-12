// @vitest-environment happy-dom
// The panel's page markup, and the speed setting it offers (#17). Its script is a module of its own
// (webview/panel.ts, #6), run in a DOM by the page tests. Solitary: node:crypto is a mock, so the page's nonce is
// known; core's constants are real.

import { ok } from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Window } from 'happy-dom';
import { SPEED_SUFFIX } from '@ai-pair/core/constants';
import { panelHtml, settingSpeed, SPEEDS } from '../src/panel_html';

/** The page the page tests load in place of panel_html.ts, so they rely on webview/panel.ts alone (#176). */
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'panel.html');

/** The webview's source for its resources, as the fixture page has it. */
const FIXTURE_CSP = 'vscode-resource:';

/** The bytes the mocked randomBytes gives, which the nonce is made of. */
const NONCE_BYTE = 7;

// happy-dom uses node:crypto too, so only randomBytes is replaced; the vscode package is CommonJS, so panel_html.ts
// reaches it through the default export, which carries the mock as well.
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  const fake = vi.fn((size: number) => Buffer.alloc(size, NONCE_BYTE));
  return { ...original, default: { ...original, randomBytes: fake }, randomBytes: fake };
});

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window } = globalThis as unknown as { window: Window };
// happy-dom loads no stylesheet unless asked; the tests need none, so the skipped fetch counts as a success.
window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;

afterEach(() => {
  vi.clearAllMocks();
});
it("loads its script from the file it is given, with the page's nonce, and has no inline script", () => {
  const html = panelHtml('vscode-resource:', 'https://file.vscode-resource/dist/panel.css', 'https://file.vscode-resource/dist/panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const policy = page.querySelector('meta[http-equiv="Content-Security-Policy"]');
  ok(policy);
  const csp = policy.getAttribute('content');
  ok(csp !== undefined && csp !== '');
  const scripts = [...page.querySelectorAll('script')];
  expect(scripts).toHaveLength(1);
  const script = scripts[0];
  ok(script);
  const nonce = Buffer.alloc(vi.mocked(randomBytes).mock.calls[0]?.[0] ?? 0, NONCE_BYTE).toString('base64');
  expect(script.getAttribute('nonce')).toBe(nonce);
  expect(csp).toContain(`script-src 'nonce-${nonce}'`);
  expect(script.getAttribute('src')).toBe('https://file.vscode-resource/dist/panel.js');
  expect(script.textContent).toBe('');
});

it('loads its styles from the file it is given, and allows no inline style', () => {
  const html = panelHtml('vscode-resource:', 'https://file.vscode-resource/dist/panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const policy = page.querySelector('meta[http-equiv="Content-Security-Policy"]');
  ok(policy);
  const csp = policy.getAttribute('content');
  ok(csp !== undefined && csp !== '');
  expect(csp).toContain('style-src vscode-resource:;');
  expect(csp).not.toContain('unsafe-inline');
  const links = [...page.querySelectorAll('link[rel="stylesheet"]')];
  expect(links.map((l) => l.getAttribute('href'))).toEqual(['https://file.vscode-resource/dist/panel.css']);
  expect(page.querySelectorAll('style')).toHaveLength(0);
});

it('offers the speeds with one decimal, so they line up', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  for (const s of SPEEDS) {
    expect(html).toContain(`data-speed="${s}">${s.toFixed(1)}${SPEED_SUFFIX}</button>`);
  }
});

it('offers the same speeds for reading, in a menu of its own', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  expect(page.querySelectorAll('[data-ui="reading-menu"] [data-speed]')).toHaveLength(SPEEDS.length);
});

it("gives controls the panel's own tooltips, since native ones show unreliably in a webview", () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  expect(html).not.toMatch(/\stitle=|\.title = /);
  expect(html).toContain('data-tip="Interrupt"');
});

it("has no id attributes: the script finds its elements by data-ui, as Google's HTML/CSS guide asks (#132)", () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  expect(page.querySelectorAll('[id]')).toHaveLength(0);
  expect(page.querySelectorAll('[data-ui]')).not.toHaveLength(0);
});

it('clamps a number to the range the setting declares, zero and below included', () => {
  expect([-1, 0, 0.1, 0.25, 1.5, 4, 9].map((value) => settingSpeed(value))).toEqual([0.25, 0.25, 0.25, 0.25, 1.5, 4, 4]);
});

it("plays at 1 for NaN, Infinity, or what isn't a number", () => {
  expect([Number.NaN, Infinity, 'fast', undefined].map((value) => settingSpeed(value))).toEqual([1, 1, 1, 1]);
});

it('is the page the page tests load, test/fixtures/panel.html: run with UPDATE_FIXTURE=1 to write it again', () => {
  const html = panelHtml(FIXTURE_CSP, 'panel.css', 'panel.js');
  if (process.env.UPDATE_FIXTURE === '1') fs.writeFileSync(FIXTURE, html);
  expect(html).toBe(fs.readFileSync(FIXTURE, 'utf8'));
});

it('shows the running extension version and build in the panel', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js', '0.10.0', 'abcd1234');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const identity = page.querySelector('.build-identity');
  ok(identity);
  expect(identity.textContent).toBe('v0.10.0 - build abcd1234');
  expect(identity.closest('[data-ui="settings-dialog"]')).not.toBeNull();
  expect(page.querySelector('.controls .build-identity')).toBeNull();
});

it('escapes the running version and build as text in Settings', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js', '<version>', 'id&more');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const identity = page.querySelector('[data-ui="settings-dialog"] .build-identity');
  ok(identity);
  expect(identity.textContent).toBe('v<version> - build id&more');
  expect(identity.children).toHaveLength(0);
});

it('explains how to click or hold the reading timer', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const control = page.querySelector('[data-ui="skip-reading"]');
  ok(control instanceof window.HTMLElement);
  expect(control.dataset.tip).toBe('Click to finish; hold to pause the timer');
});

it('places one icon-only Settings control in the toolbar before End', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const buttons = page.querySelectorAll('[data-ui="settings"]');
  expect(buttons).toHaveLength(1);
  const control = buttons[0];
  ok(control);
  expect(control.getAttribute('aria-label')).toBe('Settings');
  expect(control.querySelector('svg')).not.toBeNull();
  expect(control.textContent?.trim()).toBe('');
  expect(control.closest('.controls')).not.toBeNull();
  const next = control.nextElementSibling;
  ok(next instanceof window.HTMLElement);
  expect(next.dataset.ui).toBe('end');
  expect(page.querySelector('.settings-bar')).toBeNull();
});

it('offers an accessible automatic-terminal setting and a live reveal control', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const checkbox = page.querySelector('[data-ui="show-terminals"]');
  expect(checkbox?.getAttribute('type')).toBe('checkbox');
  expect(checkbox?.closest('label')?.textContent).toContain('Show terminals automatically');
  expect(page.querySelector('[data-ui="show-terminal"]')?.textContent).toContain('Show terminal');
});

it('offers code playback modes in a separate toolbar menu', () => {
  const html = panelHtml('source', 'style', 'script');
  expect(html).toContain('aria-label="Code display"');
  expect(html).toContain('data-code-playback="typing"');
  expect(html).toContain('data-code-playback="lines"');
  expect(html).toContain('data-code-playback="blocks"');
});

it('offers an explicit diagnostics copy button in Settings', () => {
  const page = new window.DOMParser().parseFromString(panelHtml('vscode-resource:', 'panel.css', 'panel.js'), 'text/html');
  expect(page.querySelector('[data-ui="copy-diagnostics"]')?.textContent).toContain('Copy diagnostics');
});

it('offers local speech setup, preferences, preview and stop in Settings', () => {
  const page = new window.DOMParser().parseFromString(panelHtml('source', 'style', 'script'), 'text/html');
  expect(page.querySelector('[data-ui="speech-enabled"]')?.closest('label')?.textContent).toContain(
    'Speak selected narration automatically',
  );
  expect(page.querySelector('[data-ui="speech-voice"]')?.querySelectorAll('option')).toHaveLength(4);
  expect(page.querySelector('[data-ui="speech-speed"]')?.querySelectorAll('option')).toHaveLength(4);
  expect(page.querySelector('[data-ui="speech-setup"]')?.textContent).toContain('Download Kokoro model');
  expect(page.querySelector('[data-ui="speech-preview"]')?.textContent).toContain('Preview voice');
  expect(page.querySelector('[data-ui="speech-stop"]')?.textContent).toContain('Stop speech');
  expect(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain('media-src blob:');
});

it('offers Kokoro compute choices and an explicit GPU setup check in Settings', () => {
  const page = new window.DOMParser().parseFromString(panelHtml('source', 'style', 'script'), 'text/html');
  const select = page.querySelector('[data-ui="speech-compute"]');
  expect(Array.from(select?.querySelectorAll('option') ?? []).map((option) => option.value)).toEqual(['cpu', 'auto', 'gpu']);
  expect(select?.closest('[data-ui="speech-local-model"]')).not.toBeNull();
  expect(page.querySelector('[data-ui="gpu-status"]')?.getAttribute('role')).toBe('status');
  expect(page.querySelector('[data-ui="gpu-check"]')?.textContent).toContain('Set up GPU');
  expect(page.querySelector('[data-ui="gpu-model-info"]')?.textContent).toContain('326 MB');
  expect(page.querySelector('[data-ui="gpu-model-info"]')?.textContent).toContain('additional');
  expect(page.querySelector('[data-ui="gpu-model-info"]')?.textContent).toContain('CPU model');
  expect(page.querySelector('.speech-badge')?.textContent).toContain('Experimental');
});

it('offers explicit cloud controls without exposing a key input', () => {
  const markup = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  expect(markup).toContain('data-ui="speech-provider"');
  expect(markup).toContain('data-ui="speech-key-set"');
  expect(markup).toContain('data-ui="speech-key-remove"');
  expect(markup).toContain('data-ui="speech-voices-load"');
  expect(markup).toContain('Selected narration and voice previews are sent to ElevenLabs');
  expect(markup).not.toContain('type="password"');
});

it('marks listening speed experimental in the visible settings', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const label = page.querySelector('[data-ui="speech-listening-speed"]')?.closest('label');
  expect(label?.textContent).toContain('Listening speed (experimental)');
});

it('offers OpenRouter model, voice, secure key, and ZDR controls', () => {
  const page = new window.DOMParser().parseFromString(panelHtml('vscode-resource:', 'panel.css', 'panel.js'), 'text/html');
  expect(page.querySelector('[data-ui="speech-provider"] option[value="openrouter"]')).not.toBeNull();
  expect(page.querySelector('[data-ui="openrouter-model"]')).not.toBeNull();
  expect(page.querySelector('[data-ui="openrouter-voice"]')).not.toBeNull();
  expect(page.querySelector('[data-ui="openrouter-key-set"]')).not.toBeNull();
  expect(page.querySelector('[data-ui="openrouter-zdr"]')?.getAttribute('aria-pressed')).toBe('false');
});
