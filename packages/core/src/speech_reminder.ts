/** Number of batches without selected speech before a reminder. */
const REMINDER_BATCHES = 3;

/** Counts batches until a currently available speech service warrants a reminder. */
export class SpeechReminder {
  private count = 0;

  /** Records one accepted batch. */
  batch(spoken: boolean): void {
    // specs/SpeechReminder.tla, Batch: selected narration resets the count.
    this.count = spoken ? 0 : Math.min(this.count + 1, REMINDER_BATCHES);
  }

  /** Returns whether enough batches have accumulated to check readiness. */
  due(): boolean {
    return this.count === REMINDER_BATCHES;
  }

  /** Returns a reminder once the threshold and current readiness both hold. */
  report(ready: boolean): boolean {
    // specs/SpeechReminder.tla, Report: unavailable speech never gets a reminder.
    if (!ready || this.count < REMINDER_BATCHES) return false;
    this.count = 0;
    return true;
  }
}
