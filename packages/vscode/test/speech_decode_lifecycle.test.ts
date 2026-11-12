import { expect, it } from 'vitest';
import { SpeechDecodeLifecycle } from '../src/speech_decode_lifecycle';

const first = { pageId: 1, documentGeneration: 1 };
const second = { pageId: 1, documentGeneration: 2 };
const firstJob = { ...first, requestId: 1 };
const secondJob = { ...second, requestId: 1 };

it('requires a matching readiness probe and keeps readiness scoped to the document', () => {
  const owner = new SpeechDecodeLifecycle();
  expect(owner.ready({ ...first, probeId: 1 })).toBe(false);
  expect(owner.probe({ ...first, probeId: 1 })).toBe(false);
  owner.activate(first);
  expect(owner.begin(firstJob)).toBe(false);
  expect(owner.probe({ ...first, probeId: 1 })).toBe(true);
  owner.activate(second);
  expect(owner.ready({ ...first, probeId: 1 })).toBe(false);
  expect(owner.begin(firstJob)).toBe(false);
  expect(owner.probe({ ...second, probeId: 2 })).toBe(true);
  expect(owner.ready({ ...second, probeId: 2 })).toBe(true);
  expect(owner.ready({ ...second, probeId: 2 })).toBe(false);
  expect(owner.begin(secondJob)).toBe(true);
});

it('retains a canceled decode slot until that exact operation settles', () => {
  const owner = new SpeechDecodeLifecycle();
  owner.activate(first);
  owner.probe({ ...first, probeId: 1 });
  owner.ready({ ...first, probeId: 1 });
  expect(owner.begin(firstJob)).toBe(true);
  expect(owner.begin(firstJob)).toBe(false);
  expect(owner.dispatch(firstJob)).toBe(true);
  expect(owner.dispatch(firstJob)).toBe(false);
  owner.cancel(firstJob);
  expect(owner.dispatch(firstJob)).toBe(false);
  owner.activate(second);
  owner.probe({ ...second, probeId: 2 });
  owner.ready({ ...second, probeId: 2 });
  expect(owner.begin(secondJob)).toBe(false);
  expect(owner.settle(secondJob)).toBe(false);
  expect(owner.begin(secondJob)).toBe(false);
  expect(owner.settle(firstJob)).toBe(false);
  expect(owner.begin(secondJob)).toBe(true);
  expect(owner.dispatch(secondJob)).toBe(true);
  expect(owner.settle(secondJob)).toBe(true);
  expect(owner.settle(secondJob)).toBe(false);
});

it('rejects late decode delivery and stale cancellation while allowing matching work', () => {
  const owner = new SpeechDecodeLifecycle();
  owner.activate(first);
  owner.probe({ ...first, probeId: 1 });
  owner.ready({ ...first, probeId: 1 });
  expect(owner.begin(firstJob)).toBe(true);
  owner.cancel(firstJob);
  expect(owner.dispatch(firstJob)).toBe(false);
  expect(owner.begin(firstJob)).toBe(false);
  expect(owner.begin({ ...first, requestId: 2 })).toBe(true);
  owner.cancel(firstJob);
  expect(owner.dispatch(firstJob)).toBe(false);
  expect(owner.dispatch({ ...first, requestId: 2 })).toBe(true);
  expect(owner.settle({ ...first, requestId: 2 })).toBe(true);
});

it('releases only resources belonging to the destroyed document', () => {
  const owner = new SpeechDecodeLifecycle();
  owner.activate(first);
  owner.probe({ ...first, probeId: 1 });
  owner.ready({ ...first, probeId: 1 });
  owner.begin(firstJob);
  owner.dispatch(firstJob);
  owner.activate(second);
  owner.probe({ ...second, probeId: 2 });
  owner.ready({ ...second, probeId: 2 });
  owner.destroy(second);
  expect(owner.begin(secondJob)).toBe(false);
  const third = { pageId: 1, documentGeneration: 3 };
  const thirdJob = { ...third, requestId: 1 };
  owner.activate(third);
  owner.probe({ ...third, probeId: 3 });
  owner.ready({ ...third, probeId: 3 });
  owner.destroy({ pageId: 2, documentGeneration: 1 });
  expect(owner.begin(thirdJob)).toBe(false);
  owner.destroy(first);
  expect(owner.settle(firstJob)).toBe(false);
  expect(owner.begin(thirdJob)).toBe(true);
  expect(owner.dispatch(thirdJob)).toBe(true);
  owner.destroy(third);
  expect(owner.settle(thirdJob)).toBe(false);
});

it('keeps a pending probe when the same document is activated twice', () => {
  const owner = new SpeechDecodeLifecycle();
  owner.activate(first);
  expect(owner.probe({ ...first, probeId: 1 })).toBe(true);
  expect(owner.probe({ ...first, probeId: 1 })).toBe(false);
  owner.activate(first);
  expect(owner.ready({ ...first, probeId: 1 })).toBe(true);
  expect(owner.probe({ ...first, probeId: 1 })).toBe(false);
  for (const requestId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(owner.begin({ ...first, requestId })).toBe(false);
  }
  expect(owner.begin(firstJob)).toBe(true);
});

it('rejects stale pages and generations even when request IDs match', () => {
  const owner = new SpeechDecodeLifecycle();
  const otherPage = { pageId: 2, documentGeneration: 1 };
  const otherJob = { ...otherPage, requestId: 1 };
  owner.activate(first);
  expect(owner.probe({ ...first, probeId: 1 })).toBe(true);
  owner.activate(otherPage);
  expect(owner.ready({ ...first, probeId: 1 })).toBe(false);
  expect(owner.probe({ ...otherPage, probeId: 2 })).toBe(true);
  expect(owner.ready({ ...otherPage, probeId: 2 })).toBe(true);
  expect(owner.begin(otherJob)).toBe(true);
  expect(owner.dispatch(firstJob)).toBe(false);
  owner.cancel(firstJob);
  expect(owner.dispatch(otherJob)).toBe(true);
  expect(owner.settle(firstJob)).toBe(false);
  expect(owner.begin({ ...otherPage, requestId: 2 })).toBe(false);
  expect(owner.settle(otherJob)).toBe(true);
});

it('retains a replaced document slot until settlement even without explicit cancellation', () => {
  const owner = new SpeechDecodeLifecycle();
  owner.activate(first);
  owner.probe({ ...first, probeId: 1 });
  owner.ready({ ...first, probeId: 1 });
  expect(owner.begin(firstJob)).toBe(true);
  expect(owner.dispatch(firstJob)).toBe(true);
  owner.activate(second);
  owner.probe({ ...second, probeId: 2 });
  owner.ready({ ...second, probeId: 2 });
  expect(owner.begin(secondJob)).toBe(false);
  expect(owner.settle(firstJob)).toBe(false);
  expect(owner.begin(secondJob)).toBe(true);
});

it('rejects a timed-out readiness response after a retry begins', () => {
  const owner = new SpeechDecodeLifecycle();
  const oldProbe = { ...first, probeId: 1 };
  const nextProbe = { ...first, probeId: 2 };
  owner.activate(first);
  expect(owner.isReadyFor(first)).toBe(false);
  expect(owner.probe(oldProbe)).toBe(true);
  expect(owner.probeFailed(oldProbe)).toBe(true);
  expect(owner.probeFailed(oldProbe)).toBe(false);
  expect(owner.probe(nextProbe)).toBe(true);
  expect(owner.ready(oldProbe)).toBe(false);
  expect(owner.isReadyFor(first)).toBe(false);
  expect(owner.ready(nextProbe)).toBe(true);
  expect(owner.isReadyFor(first)).toBe(true);
  expect(owner.isReadyFor(second)).toBe(false);
});

it('rejects malformed or reused probe IDs', () => {
  const owner = new SpeechDecodeLifecycle();
  owner.activate(first);
  for (const probeId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(owner.probe({ ...first, probeId })).toBe(false);
  }
  const probe = { ...first, probeId: 1 };
  expect(owner.probe(probe)).toBe(true);
  expect(owner.probeFailed(probe)).toBe(true);
  expect(owner.probe(probe)).toBe(false);
});

it('discards probe identities for the destroyed document only', () => {
  const owner = new SpeechDecodeLifecycle();
  const oldProbe = { ...first, probeId: 1 };
  const newProbe = { ...second, probeId: 2 };
  owner.activate(first);
  expect(owner.probe(oldProbe)).toBe(true);
  owner.activate(second);
  expect(owner.probe(newProbe)).toBe(true);
  owner.destroy(first);
  expect(owner.ready(oldProbe)).toBe(false);
  expect(owner.ready(newProbe)).toBe(true);
});
