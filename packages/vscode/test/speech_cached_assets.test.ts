import { expect, it } from 'vitest';
import { MODEL_ASSETS } from '../src/speech_model_manifest';

it('requires the pinned phonemizer executable and license in the verified installation', () => {
  expect(MODEL_ASSETS).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'runtime/phonemizer-1.2.1.mjs',
        size: 1_322_380,
        sha256: '193481f474f7c1ea81df3195d18b45df8ef7254dbdccb3f193d60215c4897bec',
        url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js',
      }),
      expect.objectContaining({
        path: 'runtime/phonemizer-1.2.1-LICENSE.txt',
        size: 11_357,
        sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
        url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/LICENSE',
      }),
    ]),
  );
});
