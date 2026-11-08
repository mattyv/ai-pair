import type { AudioDevice } from './index';

interface Catalog {
  devices: AudioDevice[];
  defaultId: string | null;
}
const MAX_CATALOG = 65_536;
const MAX_DEVICES = 64;
const MAX_ID = 512;
const MAX_LABEL = 256;
const CATALOG_FIELDS = 3;
const DEVICE_FIELDS = 2;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the helper's private discovery response without forwarding raw errors. */
export function parseCatalog(text: string): Catalog | undefined {
  if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    !record(value) ||
    Object.keys(value).length !== CATALOG_FIELDS ||
    value.version !== 1 ||
    !Array.isArray(value.devices) ||
    value.devices.length > MAX_DEVICES
  ) {
    return undefined;
  }
  const devices: AudioDevice[] = [];
  const ids = new Set<string>();
  for (const device of value.devices as unknown[]) {
    if (
      !record(device) ||
      Object.keys(device).length !== DEVICE_FIELDS ||
      typeof device.id !== 'string' ||
      device.id.length === 0 ||
      Buffer.byteLength(device.id, 'utf8') > MAX_ID ||
      typeof device.label !== 'string' ||
      Buffer.byteLength(device.label, 'utf8') > MAX_LABEL ||
      ids.has(device.id)
    ) {
      return undefined;
    }
    ids.add(device.id);
    devices.push({ id: device.id, label: device.label });
  }
  if (value.defaultId !== null && (typeof value.defaultId !== 'string' || !ids.has(value.defaultId))) return undefined;
  return { devices, defaultId: value.defaultId };
}
