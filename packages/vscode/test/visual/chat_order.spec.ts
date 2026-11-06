// Browser behavior for chat order, scrolling and the in-panel settings dialog.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { panelHtml } from '../../src/panel_html';

const DIST = path.resolve('packages/vscode/dist');
const ORIGIN = 'https://panel.test';

/** Loads the panel with a recording VS Code API and returns a way to send host events. */
async function load(page: Page): Promise<(event: object) => Promise<void>> {
  const html = panelHtml(ORIGIN, `${ORIGIN}/panel.css`, `${ORIGIN}/panel.js`).replace(
    '<link rel="stylesheet"',
    `<link rel="stylesheet" href="${ORIGIN}/theme.css"><link rel="stylesheet"`,
  );
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname;
    if (file === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    if (file === '/theme.css') {
      return route.fulfill({
        body: `
  :root {
    --vscode-font-family: -apple-system, system-ui, sans-serif; --vscode-font-size: 13px;
    --vscode-editor-font-family: Menlo, monospace; --vscode-editor-font-size: 12px;
    --vscode-foreground: #cccccc; --vscode-editor-background: #1f1f1f; --vscode-sideBar-background: #181818;
    --vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff; --vscode-button-border: transparent;
    --vscode-button-hoverBackground: #026ec1; --vscode-button-secondaryBackground: #313131;
    --vscode-button-secondaryForeground: #cccccc; --vscode-button-secondaryBorder: transparent;
    --vscode-button-secondaryHoverBackground: #3c3c3c; --vscode-charts-green: #89d185;
    --vscode-contrastActiveBorder: transparent; --vscode-contrastBorder: transparent;
    --vscode-editorHoverWidget-background: #202020; --vscode-editorHoverWidget-border: #454545;
    --vscode-editorHoverWidget-foreground: #cccccc; --vscode-errorForeground: #f85149; --vscode-focusBorder: #0078d4;
    --vscode-input-background: #313131; --vscode-input-border: #3c3c3c; --vscode-input-foreground: #cccccc;
    --vscode-input-placeholderForeground: #989898; --vscode-menu-background: #1f1f1f; --vscode-menu-border: #454545;
    --vscode-menu-foreground: #cccccc; --vscode-menu-selectionBackground: #0078d4; --vscode-menu-selectionForeground: #ffffff;
    --vscode-panel-border: #2b2b2b; --vscode-testing-iconFailed: #f14c4c; --vscode-testing-iconPassed: #73c991;
    --vscode-textLink-activeForeground: #4daafc; --vscode-textLink-foreground: #4daafc;
    --vscode-toolbar-hoverBackground: #5a5d5e50; --vscode-widget-border: #313131; --vscode-widget-shadow: #0000005c;
    --vscode-aiPair-cursor: #e8875b; --vscode-aiPair-cursorRead: #7fb2f0;
  }
  body { background: var(--vscode-sideBar-background); }
`,
        contentType: 'text/css',
      });
    }
    return route.fulfill({
      body: fs.readFileSync(path.join(DIST, file)),
      contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
    });
  });
  await page.addInitScript(() => {
    const messages: unknown[] = [];
    Object.assign(globalThis, {
      messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => {
          messages.push(message);
        },
      }),
    });
  });
  await page.goto(`${ORIGIN}/`);
  return async (event) => {
    await page.evaluate((data) => {
      // The browser global is the window; this file is typed without the DOM library.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      (globalThis as unknown as { postMessage(message: unknown, origin: string): void }).postMessage(data, '*');
    }, event);
  };
}

/** Populates enough history to make the panel scroll. */
async function populate(post: (event: object) => Promise<void>): Promise<void> {
  await post({ type: 'session', active: true, task: 'Order test' });
  for (let index = 0; index < 35; index++) {
    await post({ type: 'say', text: `Message ${index}: a long message that wraps across multiple lines in the panel.` });
  }
}

/** Reads the distance between the history viewport and its newest edge. */
async function distanceFromBottom(page: Page): Promise<number> {
  return page
    .locator('[data-ui=history]')
    .evaluate(
      (element: { scrollHeight: number; clientHeight: number; scrollTop: number }) =>
        element.scrollHeight - element.clientHeight - element.scrollTop,
    );
}

test('settings work with the keyboard and send the chosen order', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  const settings = page.getByRole('button', { name: 'Settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const order = dialog.getByLabel('Chat order');
  await expect(dialog).toBeVisible();
  await expect(order).toBeFocused();
  await expect(order).toHaveValue('newestFirst');
  await order.selectOption('oldestFirst');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: unknown[] }).messages;
      }),
    )
    .toContainEqual({ type: 'chatOrder', value: 'oldestFirst' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(settings).toBeFocused();
  await settings.press('Enter');
  await expect(order).toHaveValue('oldestFirst');
  await order.focus();
  await page.keyboard.press('Space');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter((message) => message.type === 'pause');
      }),
    )
    .toEqual([]);
});

test('DisplayOrdered, NoneLost and NoDuplicates: switching reverses populated history and keeps the draft', async ({ page }) => {
  const post = await load(page);
  await populate(post);
  const history = page.locator('[data-ui=history]');
  const band = page.locator('[data-ui=band]');
  const reply = page.getByLabel('Reply to the agent');
  await reply.fill('Unsent draft');
  const before = await history.locator('.entry').allTextContents();
  expect(before.length).toBeGreaterThan(30);
  expect((await band.boundingBox())?.y).toBeLessThan((await history.boundingBox())?.y ?? 0);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, oldest first');
  await expect.poll(async () => history.locator('.entry').allTextContents()).toEqual(before.toReversed());
  expect((await history.boundingBox())?.y).toBeLessThan((await band.boundingBox())?.y ?? 0);
  await expect(reply).toHaveValue('Unsent draft');
  await post({ type: 'chatOrder', value: 'newestFirst' });
  await expect.poll(async () => history.locator('.entry').allTextContents()).toEqual(before);
  await expect(reply).toHaveValue('Unsent draft');
});

test('FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await populate(post);
  const history = page.locator('[data-ui=history]');
  await expect.poll(async () => history.locator('.entry').count()).toBeGreaterThan(30);
  await history.evaluate((element: { scrollTop: number; scrollHeight: number }) => {
    element.scrollTop = element.scrollHeight;
  });
  await post({ type: 'say', text: 'A new message with enough text to wrap across the panel. '.repeat(8) });
  await expect(page.locator('[data-ui=now-text]')).toContainText('A new message');
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await post({ type: 'run', id: 8, command: 'npm test', phase: 'confirm' });
  await expect(page.locator('[data-ui=run]')).toBeVisible();
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await page.getByLabel('Reply to the agent').fill('draft '.repeat(100));
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect.poll(async () => distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await post({ type: 'interrupt' });
  await expect(history.getByText('You interrupted')).toBeAttached();
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await history.evaluate((element: { scrollTop: number }) => {
    element.scrollTop = 40;
  });
  const before = await history.evaluate((element: { scrollTop: number }) => element.scrollTop);
  await post({ type: 'say', text: 'Another incoming message' });
  await expect(page.locator('[data-ui=now-text]')).toContainText('Another incoming message');
  expect(await history.evaluate((element: { scrollTop: number }) => element.scrollTop)).toBeCloseTo(before, 0);
  await post({ type: 'programmer', text: 'My reply' });
  await expect(history.getByText('My reply')).toBeVisible();
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
});

test('SwitchKeepsPlace: switching order keeps the visible history entry in place', async ({ page }) => {
  const post = await load(page);
  await populate(post);
  const history = page.locator('[data-ui=history]');
  await history.evaluate((element: { scrollTop: number; scrollHeight: number; clientHeight: number }) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  });
  const historyBefore = await history.boundingBox();
  const entries = await history.locator('.entry').all();
  let anchorText = '';
  for (const entry of entries) {
    const bounds = await entry.boundingBox();
    if (bounds !== null && bounds.y + bounds.height > (historyBefore?.y ?? 0)) {
      anchorText = (await entry.textContent()) ?? '';
      break;
    }
  }
  const anchor = history.locator('.entry').filter({ hasText: anchorText });
  const before = await anchor.boundingBox();
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, oldest first');
  const after = await anchor.boundingBox();
  const historyAfter = await history.boundingBox();
  expect((after?.y ?? 0) - (historyAfter?.y ?? 0)).toBeCloseTo((before?.y ?? 0) - (historyBefore?.y ?? 0), 0);
  await post({ type: 'chatOrder', value: 'newestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, newest first');
  const restored = await anchor.boundingBox();
  const restoredHistory = await history.boundingBox();
  expect((restored?.y ?? 0) - (restoredHistory?.y ?? 0)).toBeCloseTo((before?.y ?? 0) - (historyBefore?.y ?? 0), 0);
});

test('SwitchKeepsPlace: a boundary anchor remains visible when its old offset cannot fit', async ({ page }) => {
  const post = await load(page);
  await populate(post);
  const history = page.locator('[data-ui=history]');
  await history.evaluate((element: { scrollTop: number; clientHeight: number }) => {
    element.scrollTop = element.clientHeight / 2;
  });
  const historyBefore = await history.boundingBox();
  const entries = await history.locator('.entry').all();
  let anchorText = '';
  for (const entry of entries) {
    const bounds = await entry.boundingBox();
    if (bounds !== null && bounds.y + bounds.height > (historyBefore?.y ?? 0)) {
      anchorText = (await entry.textContent()) ?? '';
      break;
    }
  }
  const anchor = history.locator('.entry').filter({ hasText: anchorText });
  const anchorBefore = await anchor.boundingBox();
  expect((anchorBefore?.y ?? 0) + (anchorBefore?.height ?? 0)).toBeGreaterThan(historyBefore?.y ?? 0);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, oldest first');
  const historyAfter = await history.boundingBox();
  const anchorAfter = await anchor.boundingBox();
  expect((anchorAfter?.y ?? 0) + (anchorAfter?.height ?? 0)).toBeGreaterThan(historyAfter?.y ?? 0);
  expect(anchorAfter?.y).toBeLessThan((historyAfter?.y ?? 0) + (historyAfter?.height ?? 0));
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
});

test('agent and programmer history text use the readable theme foreground', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'say', text: 'Agent history text' });
  await post({ type: 'programmer', text: 'Programmer history text' });
  async function color(selector: string): Promise<string> {
    return page.locator(selector).evaluate((element: unknown) => {
      // The browser supplies getComputedStyle; this test is typed without the DOM library.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return (globalThis as unknown as { getComputedStyle(element: unknown): { color: string } }).getComputedStyle(element).color;
    });
  }
  await expect(page.locator('.entry.agent')).toHaveText('Agent history text');
  const foreground = await color('body');
  expect(await color('.entry.agent')).toBe(foreground);
  expect(await color('.entry.you')).toBe(foreground);
  await post({ type: 'state', state: 'typing', turn: 'agent', paused: true });
  await expect(page.locator('body')).toHaveClass(/paused/);
  expect(await color('.entry.agent')).toBe(foreground);
  expect(await color('.entry.you')).toBe(foreground);
});

test('agent and programmer messages appear once in chronological order in both layouts', async ({ page }) => {
  const post = await load(page);
  await post({
    type: 'replay',
    events: [
      { type: 'session', active: true },
      { type: 'say', text: 'Start WP2, or stop here?' },
      { type: 'programmer', text: 'go' },
    ],
  });
  await expect(page.getByText('Start WP2, or stop here?', { exact: true })).toHaveCount(1);
  expect((await page.getByText('go', { exact: true }).boundingBox())?.y).toBeLessThan(
    (await page.getByText('Start WP2, or stop here?', { exact: true }).boundingBox())?.y ?? 0,
  );
  await post({ type: 'say', text: 'Starting WP2.' });
  const first = page.getByText('Start WP2, or stop here?', { exact: true });
  const second = page.getByText('go', { exact: true });
  const third = page.getByText('Starting WP2.', { exact: true });
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await expect(third).toHaveCount(1);
  expect((await third.boundingBox())?.y).toBeLessThan((await second.boundingBox())?.y ?? 0);
  expect((await second.boundingBox())?.y).toBeLessThan((await first.boundingBox())?.y ?? 0);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(page.locator('[data-ui=history]')).toHaveAttribute('aria-label', 'Earlier, oldest first');
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await expect(third).toHaveCount(1);
  expect((await first.boundingBox())?.y).toBeLessThan((await second.boundingBox())?.y ?? 0);
  expect((await second.boundingBox())?.y).toBeLessThan((await third.boundingBox())?.y ?? 0);
  const current = page.locator('[data-ui=now-text]');
  await expect(current).toHaveCSS('opacity', '1');
  await post({ type: 'state', state: 'typing', turn: 'agent', paused: true });
  await expect(page.locator('body')).toHaveClass(/paused/);
  await expect(current).toHaveCSS('opacity', '1');
});
