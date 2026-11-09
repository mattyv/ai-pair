import { LOCAL_MAX_WAV_BYTES, LOCAL_RESPONSE, type LocalResponse } from './speech_local_protocol';

const BASE64_GROUP_LENGTH = 4;
const BASE64_GROUP_BYTES = 3;

/** Encodes a validated worker response using JSON-compatible audio bytes. */
export function encodeGpuResponse(value: LocalResponse): object {
  const response = LOCAL_RESPONSE.parse(value);
  return response.type === 'result' ? { ...response, wav: Buffer.from(response.wav).toString('base64') } : response;
}

/** Decodes and validates a bounded response from the GPU child process. */
export function decodeGpuResponse(value: unknown): LocalResponse | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) return undefined;
  let decoded: unknown = value;
  if (value.type === 'result') {
    if (
      !('wav' in value) ||
      typeof value.wav !== 'string' ||
      value.wav.length > BASE64_GROUP_LENGTH * Math.ceil(LOCAL_MAX_WAV_BYTES / BASE64_GROUP_BYTES) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.wav)
    ) {
      return undefined;
    }
    const bytes = Buffer.from(value.wav, 'base64');
    if (bytes.toString('base64') !== value.wav) return undefined;
    decoded = { ...value, wav: new Uint8Array(bytes) };
  }
  const parsed = LOCAL_RESPONSE.safeParse(decoded);
  return parsed.success ? parsed.data : undefined;
}
