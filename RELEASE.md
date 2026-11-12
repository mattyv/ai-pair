# Release checklist

Use this checklist before publishing a release. Record the evidence and any
remaining limitations with the release; a skipped check is not a pass.

1.  Review and update [README.md](README.md), the packaged
    [AI Pair README](packages/vscode/README.md), and the packaged
    [Local Audio README](packages/audio-ui/README.md) for current installation,
    behavior, and limitations. Check both extension IDs and the paired
    installation and reload instructions.
2.  Review the [architecture](ARCHITECTURE.md) and `.archi` model. If the
    architecture changed, update the source model and generated exports
    together and record how their synchronization was verified. Otherwise,
    record that the architecture was reviewed and remains current.
3.  Check that the AI Pair and AI Pair Local Audio versions match, and update
    the [changelog](packages/vscode/CHANGELOG.md) for the release. Review
    [decisions](DECISIONS.md) for material choices and limitations.
4.  Run the relevant tests and release checks, including CI on the supported
    platforms. Record failures, skipped tests, and unverified hardware or human
    listening separately from passing results. Use the
    [candidate smoke test](docs/release-candidate-smoke.md) when applicable.
5.  Build and inspect the paired VSIX artifacts for the intended platforms.
    Verify their versions and checksums, and provide the checksum file with the
    release assets. Do not label a missing platform or untested device as
    verified.
6.  Obtain the required publishing approval before publishing or pushing.
    The current `npm run release` script handles the main extension; verify the
    companion and platform assets separately. Preserve the exact artifacts
    checked for publication and release.
