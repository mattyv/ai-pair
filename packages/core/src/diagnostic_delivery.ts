/** Dispatches a diagnostic without allowing an observer to change the observed operation. */
export function reportDiagnostic<Event>(observer: ((event: Event) => void) | undefined, event: Event, receiver: unknown): void {
  // specs/DiagnosticsFaultIsolation.tla, Attempt: an observer failure cannot escape.
  try {
    observer?.call(receiver, event);
  } catch {
    // Diagnostic observers cannot change the operation they observe.
  }
}
