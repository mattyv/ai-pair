/** Confirms that an ONNX Runtime profile contains completed WebGPU node work. */
export function hasGpuWork(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry: unknown) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('cat' in entry) ||
      entry.cat !== 'Node' ||
      !('dur' in entry) ||
      typeof entry.dur !== 'number' ||
      !Number.isFinite(entry.dur) ||
      entry.dur <= 0 ||
      !('args' in entry)
    ) {
      return false;
    }
    const args: unknown = entry.args;
    return (
      typeof args === 'object' &&
      args !== null &&
      'provider' in args &&
      args.provider === 'WebGpuExecutionProvider' &&
      'op_name' in args &&
      typeof args.op_name === 'string' &&
      args.op_name !== '' &&
      !args.op_name.startsWith('Memcpy')
    );
  });
}
