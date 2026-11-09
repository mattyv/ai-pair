/** Recognizes the pinned runtime's explicit no-adapter result, never a generic failure. */
export function observedNoAdapter(error: unknown, loaderVerified: boolean): boolean {
  return loaderVerified && error instanceof Error && error.message.includes('Failed to get a WebGPU adapter: No supported adapters');
}
