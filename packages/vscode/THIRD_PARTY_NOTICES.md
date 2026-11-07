# Speech runtime third-party notices

The optional Linux x64 speech runtime uses the following components. Bundled
package license files are in `dist/speech/node_modules` except where noted.

-   Kokoro.js 1.2.1, Apache-2.0: <https://github.com/hexgrad/kokoro-js>
-   Transformers.js 3.8.1, Apache-2.0: <https://github.com/huggingface/transformers.js>
-   The explicit setup downloads phonemizer 1.2.1 and its Apache-2.0 package
    license to the verified local cache: <https://github.com/xenova/phonemizer.js>
    The downloaded phonemizer bundle embeds eSpeak NG, which is
    GPL-3.0-or-later;
    its source is available at <https://github.com/espeak-ng/espeak-ng>. The exact
    eSpeak NG revision used for this phonemizer release is not identified in
    the published package. GPL-3.0 text is in `third_party/GPL-3.0.txt`.
-   ONNX Runtime Node and common 1.21.0, MIT:
    <https://github.com/microsoft/onnxruntime/tree/v1.21.0>. License text is in
    `third_party/ONNXRUNTIME-LICENSE.txt`.
-   sharp 0.34.5 and @img/sharp-linux-x64 0.34.5, Apache-2.0:
    <https://github.com/lovell/sharp>
-   @img/sharp-libvips-linux-x64 1.2.4: LGPL-3.0-or-later and other licenses.
    Its included README lists the upstream libraries and applicable notices, and
    `versions.json` records their versions. Source and build instructions are at
    <https://github.com/lovell/sharp-libvips/tree/v1.2.4>. The pinned
    [build version inventory](https://github.com/lovell/sharp-libvips/blob/v1.2.4/versions.properties)
    matches the shipped `versions.json`. LGPL-3.0 text is in
    `third_party/LGPL-3.0.txt` and GPL-3.0 text is also included.
-   @img/colour 1.1.0, MIT: <https://github.com/lovell/colour>
-   detect-libc 2.1.2, Apache-2.0: <https://github.com/lovell/detect-libc>
-   semver 7.8.5, ISC: <https://github.com/npm/node-semver>

The separately downloaded Kokoro model is pinned in the source manifest. Its
upstream model card and license are at
<https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX>.
