# Kokoro phonemization source

`kokoro_phonemize.mjs` is copied from the Apache-2.0 Kokoro JS phonemizer:
<https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/phonemize.js>.
It preserves upstream normalization and punctuation handling while letting the
worker check all token IDs before calling `generate_from_ids`. The Kokoro
license is supplied with the packaged runtime. The `phonemizer` package and
its eSpeak NG dependencies have separate notices in the packaged runtime.
