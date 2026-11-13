import { ok } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { SpeechContext } from '../src/speech_context';

const config = { enabled: true, provider: 'p', model: 'm', voice: 'v' };

function capture(context: SpeechContext, text: string) {
  const result = context.capture(text);
  ok(result);
  return result;
}

describe('SpeechContext', () => {
  it('captures only completed speech and preserves it across cancellation and replay', () => {
    const context = new SpeechContext();
    context.session(1, true);
    context.configure(config);
    const first = capture(context, 'first');
    expect(first.previousText).toBeUndefined();
    first.complete();
    first.complete();
    const canceled = capture(context, 'canceled');
    expect(canceled.previousText).toBe('first');
    canceled.cancel();
    canceled.complete();
    context.session(1, true);
    expect(capture(context, 'next').previousText).toBe('first');
  });

  it('invalidates stale completion on reset and superseding capture', () => {
    const context = new SpeechContext();
    context.session(1, true);
    context.configure(config);
    const stale = capture(context, 'stale');
    context.session(2, true);
    stale.complete();
    const current = capture(context, 'current');
    expect(current.previousText).toBeUndefined();
    const replacement = capture(context, 'replacement');
    current.complete();
    replacement.complete();
    expect(capture(context, 'next').previousText).toBe('replacement');
  });

  it('resets on setting changes, session end and disconnect', () => {
    const context = new SpeechContext();
    context.session(1, true);
    context.configure(config);
    capture(context, 'one').complete();
    context.configure({ ...config });
    expect(capture(context, 'two').previousText).toBe('one');
    context.configure({ ...config, voice: 'other' });
    expect(capture(context, 'three').previousText).toBeUndefined();
    capture(context, 'three').complete();
    context.session(1, false);
    context.session(1, true);
    expect(capture(context, 'four').previousText).toBeUndefined();
    context.disconnect();
    expect(context.capture('five')).toBeUndefined();
    context.session(2, true);
    context.configure({ ...config, enabled: false });
    expect(context.capture('six')).toBeUndefined();
  });

  it('bounds history to three utterances and 500 Unicode code points including separators', () => {
    const context = new SpeechContext();
    context.session(1, true);
    context.configure(config);
    for (const text of ['one', 'two', 'three', 'four']) capture(context, text).complete();
    expect(capture(context, 'five').previousText).toBe('two three four');
    capture(context, '\u{1F600}'.repeat(600)).complete();
    const previous = capture(context, 'next').previousText;
    ok(previous !== undefined);
    expect(Array.from(previous)).toHaveLength(500);
    expect(previous).toBe('\u{1F600}'.repeat(500));
  });
});
