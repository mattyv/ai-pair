/** The current system output, or one explicitly named native output. */
export type OutputChoice = { kind: 'default' } | { kind: 'native'; backend: 'pipewire' | 'coreaudio' | 'wasapi'; name: string };
/** A device presented to the user, with its current availability. */
export interface OutputDevice {
  choice: Extract<OutputChoice, { kind: 'native' }>;
  label: string;
  available: boolean;
}
/** Fixed failure reasons; never include host paths or process output. */
export type OutputUnavailableReason = 'unsupported' | 'unavailable' | 'timeout' | 'invalid' | 'system_error';
/** An explicit refresh result and the selected local preference. */
export interface OutputCatalog {
  supported: boolean;
  devices: OutputDevice[];
  selected: OutputChoice;
  reason?: OutputUnavailableReason;
}
