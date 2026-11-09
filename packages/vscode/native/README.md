# GPU hardware probe

`gpu_probe.c` uses the pinned Khronos headers under `vulkan/` to inspect one
Vulkan physical device. It is compiled for Linux and packaged with the optional
GPU runtime; it does not load an inference model or collect device identifiers.

`gpu_probe.onnx` is the 130-byte `mul_1.onnx` test graph from ONNX Runtime
v1.24.3, fetched from
`https://raw.githubusercontent.com/microsoft/onnxruntime/v1.24.3/onnxruntime/test/testdata/mul_1.onnx`.
Its SHA-256 is
`71f431c4e9321ec6fbeb158d02ed240459a7dcc98673fa79a4f439ce42efaf10`.
ONNX Runtime is MIT licensed; its license ships in the extension's third-party
notices.
