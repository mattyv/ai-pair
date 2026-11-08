import { describe, expect, it } from 'vitest';
import { SpeechReminder } from '../src/speech_reminder';

describe('SpeechReminder', () => {
  it('reminds after three unspoken batches only when ready, then counts again', () => {
    const reminder = new SpeechReminder();
    expect(reminder.due()).toBe(false);
    reminder.batch(false);
    reminder.batch(false);
    expect(reminder.report(true)).toBe(false);
    reminder.batch(false);
    expect(reminder.due()).toBe(true);
    expect(reminder.report(false)).toBe(false);
    expect(reminder.report(true)).toBe(true);
    expect(reminder.report(true)).toBe(false);
  });

  it('resets its count on a selected narration', () => {
    const reminder = new SpeechReminder();
    reminder.batch(false);
    reminder.batch(false);
    reminder.batch(true);
    reminder.batch(false);
    expect(reminder.report(true)).toBe(false);
  });
});
