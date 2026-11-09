/** Identifies a bounded GPU model download timeout without exposing details. */
export class GpuModelTimeoutError extends Error {
  constructor() {
    super('GPU model download timed out.');
  }
}
