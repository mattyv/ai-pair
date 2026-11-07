# Coverage

What each coverage tool last measured, for every source file, in one place.
Each run rewrites its own column: `npm run test:coverage` the unit column
(vitest, v8) and the CSS column (the stylesheet's rules the page matched),
`npm run test:integration:coverage` the integration column (c8 over the
extension host, mapped back to the sources), `npm run coverage:tla` the TLC
column (how many of a spec's actions fired in any of its configs),
`npm run test:swift:coverage` the Swift column (llvm-cov), and
`npm run test:shell:coverage` the Shell column (kcov over the bats tests).
A run with `--check` fails below the minimums in
[coverage_thresholds.json](coverage_thresholds.json), each file's measured
coverage rounded down; a change that raises a file's coverage raises its
minimum in the same PR (#161).
L, B, R, and F are lines, branches, regions, and functions covered. `-` is a
file no tool measures; `test` is a test. Which spec covers which source file
is in [specs/COVERAGE.md](specs/COVERAGE.md).

Last updated: tla, 2026-11-07.

| File | Type | Unit | Integration | TLC | Swift | Shell | CSS |
|---|---|---|---|---|---|---|---|
| `.claude/skills/reload-extension/scripts/reload.sh` | Shell | - | - | - | - | L 0.0% (0 of 16) | - |
| `packages/core/src/bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/config.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/constants.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/controller.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/diff.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 94.7% B 81.8% F 100.0% | - | - | - | - |
| `packages/core/src/index.ts` | TypeScript | - | - | - | - | - | - |
| `packages/core/src/lines.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 95.5% F 100.0% | - | - | - | - |
| `packages/core/src/paths.ts` | TypeScript | - | - | - | - | - | - |
| `packages/core/src/places.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/player.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 99.4% F 100.0% | - | - | - | - |
| `packages/core/src/ports.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/rehearsal.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/structural_typing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/core/src/text.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/timeline.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 95.7% F 100.0% | - | - | - | - |
| `packages/core/src/timing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/core/src/typing.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 96.3% B 95.7% F 100.0% | - | - | - | - |
| `packages/core/test/bridge.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/controller.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/diff.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/fake.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/lines.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/places.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/player.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/rehearsal.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/session.e2e.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/core/test/structural_typing.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/core/test/text.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/timeline.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/timing.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/core/test/typing.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/src/index.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/paths.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 83.3% F 100.0% | - | - | - | - |
| `packages/protocol/src/schemas.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/src/wire.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/protocol/test/index.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/test/paths.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/protocol/test/wire.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/src/guide.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.6% B 88.9% F 100.0% | - | - | - | - |
| `packages/relay/src/link.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/relay/src/main.ts` | TypeScript | - | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/relay/src/md.d.ts` | TypeScript | - | - | - | - | - | - |
| `packages/relay/src/render.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 67.4% B 52.2% F 69.2% | - | - | - | - |
| `packages/relay/src/server.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 93.0% B 84.8% F 88.9% | - | - | - | - |
| `packages/relay/src/timings.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 50.0% F 100.0% | - | - | - | - |
| `packages/relay/src/tools.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/relay/test/guide.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/link.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/relay.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/render.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/server.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/timings.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/relay/test/tools.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/relay/test/validation.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/scripts/build.mts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/scripts/build.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/scripts/icon/Package.swift` | Swift | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Sources/IconDrawing/Icon.swift` | Swift | - | - | - | L 99.3% R 93.3% F 100.0% | - | - |
| `packages/vscode/scripts/icon/Sources/icon/main.swift` | Swift | - | - | - | - | - | - |
| `packages/vscode/scripts/icon/Tests/IconDrawingTests/IconDrawingTests.swift` | Swift | - | - | - | L 99.2% R 98.3% F 98.0% | - | - |
| `packages/vscode/scripts/integration.sh` | Shell | - | - | - | - | - | - |
| `packages/vscode/scripts/speech_runtime.mts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/scripts/vscode_bin.mts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/scripts/vscode_bin.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/src/agents.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 81.1% B 66.7% F 87.2% | - | - | - | - |
| `packages/vscode/src/calibration.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 71.7% B 88.9% F 50.0% | - | - | - | - |
| `packages/vscode/src/demo.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 95.8% B 83.9% F 100.0% | - | - | - | - |
| `packages/vscode/src/diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/editor.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.3% B 90.7% F 97.9% | - | - | - | - |
| `packages/vscode/src/extension.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 93.0% B 92.7% F 83.8% | - | - | - | - |
| `packages/vscode/src/output.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 93.2% B 90.9% F 100.0% | - | - | - | - |
| `packages/vscode/src/outside.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/outside_watch.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 96.5% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 66.8% B 58.7% F 83.3% | - | - | - | - |
| `packages/vscode/src/panel_html.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 80.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/panel_messages.ts` | TypeScript | L 0.0% B 0.0% F 0.0% | - | - | - | - | - |
| `packages/vscode/src/passage.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/python_diagnostics.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/setup.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 83.8% B 84.2% F 83.3% | - | - | - | - |
| `packages/vscode/src/speech_catalog.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_credentials.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_elevenlabs.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_engine.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_model_manifest.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_pcm.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_phonemizer_bridge.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_runtime_status.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_service.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_setup.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_synthesis.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_types.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_waveform.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_worker.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_worker_host.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/speech_worker_messages.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/terminal.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 98.3% B 98.1% F 92.3% | - | - | - | - |
| `packages/vscode/src/timings.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 100.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/view.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | L 100.0% B 88.0% F 100.0% | - | - | - | - |
| `packages/vscode/src/webview/panel.css` | CSS | - | - | - | - | - | 148 of 148 rules matched |
| `packages/vscode/src/webview/panel.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/src/webview/speech_audio.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `packages/vscode/test/agents.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/calibration.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/css.e2e.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/demo.e2e.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/demo.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/diagnostics.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/editor.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/extension.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/integration.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/integration_paths.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/launcher.e2e.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/output.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/outside.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/outside_watch.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/page.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/panel.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/panel_html.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/passage.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/python_diagnostics.e2e.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/python_diagnostics.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/setup.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/smoke_integration.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_audio.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_cached_assets.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_catalog.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_credentials.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_elevenlabs.e2e.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_elevenlabs.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_engine.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_pcm.e2e.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_pcm.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_phonemizer_bridge.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_runtime.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_service.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_setup.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_setup_fs.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_smoke_integration.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_smoke_integration.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_synthesis.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_waveform.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_worker.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_worker_host.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/speech_worker_messages.test.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/terminal.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/terminal_smoke_integration.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/timings.test.ts` | TypeScript | test | test | test | test | - | test |
| `packages/vscode/test/view.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/visual/chat_order.spec.ts` | TypeScript | test | - | test | - | - | test |
| `packages/vscode/test/visual/panel.spec.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/test/webview/panel.test.ts` | TypeScript | test | test | test | test | test | test |
| `packages/vscode/vendor/kokoro_phonemize.d.mts` | TypeScript | - | - | - | - | - | - |
| `playwright.config.ts` | TypeScript | - | - | - | - | - | - |
| `scripts/check_ascii.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/check_ascii.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/coverage_report.e2e.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/coverage_report.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/coverage_report.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/coverage_shell.sh` | Shell | - | - | - | - | - | - |
| `scripts/coverage_swift.sh` | Shell | - | - | - | - | - | - |
| `scripts/lint_shell.sh` | Shell | - | - | - | - | - | - |
| `scripts/lint_tla.test.ts` | TypeScript | test | test | test | test | test | test |
| `scripts/lint_tla.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/lint_web.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/lint_web.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/release.test.ts` | TypeScript | test | test | test | test | - | test |
| `scripts/release.ts` | TypeScript | L 100.0% B 100.0% F 100.0% | - | - | - | - | - |
| `scripts/stylelint.config.ts` | TypeScript | - | - | - | - | - | - |
| `specs/ActionValidation.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ActionValidation.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Actions.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Actions.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/Anchor.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Anchor.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/BatchFile.cfg` | TLC config | - | - | - | - | - | - |
| `specs/BatchFile.tla` | TLA+ | - | - | 4 of 4 actions | - | - | - |
| `specs/Bridge.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Bridge.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/BuildIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/BuildIdentity.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/Calibration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Calibration.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/CloudNarration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CloudNarration.tla` | TLA+ | - | - | 11 of 12 actions (never: Retry) | - | - | - |
| `specs/CloudNarration_Healthy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CodePlayback.cfg` | TLC config | - | - | - | - | - | - |
| `specs/CodePlayback.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/CodePlayback_Progress.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Controller.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Controller.tla` | TLA+ | - | - | 17 of 17 actions | - | - | - |
| `specs/Diagnostics.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Diagnostics.tla` | TLA+ | - | - | 5 of 5 actions | - | - | - |
| `specs/DiagnosticsCopy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsCopy.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/DiagnosticsPrivacy.cfg` | TLC config | - | - | - | - | - | - |
| `specs/DiagnosticsPrivacy.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/Discovery.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Discovery.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/Discovery_InPlace.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Draft.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Draft.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/EditEvents.cfg` | TLC config | - | - | - | - | - | - |
| `specs/EditEvents.tla` | TLA+ | - | - | 4 of 4 actions | - | - | - |
| `specs/EditorAdapter.cfg` | TLC config | - | - | - | - | - | - |
| `specs/EditorAdapter.tla` | TLA+ | - | - | 14 of 14 actions | - | - | - |
| `specs/FileText.cfg` | TLC config | - | - | - | - | - | - |
| `specs/FileText.tla` | TLA+ | - | - | 10 of 10 actions | - | - | - |
| `specs/FollowMode.cfg` | TLC config | - | - | - | - | - | - |
| `specs/FollowMode.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/LineEndGuard.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LineEndGuard.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/LineIdentity.cfg` | TLC config | - | - | - | - | - | - |
| `specs/LineIdentity.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/ListenGrace.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ListenGrace.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/ListeningHint.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ListeningHint.tla` | TLA+ | - | - | 2 of 2 actions | - | - | - |
| `specs/Narration.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Narration.tla` | TLA+ | - | - | 20 of 20 actions | - | - | - |
| `specs/Navigator.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Navigator.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/Outside.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Outside.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/PairDefs.tla` | TLA+ | - | - | - | - | - | - |
| `specs/Panel.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Panel.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/PanelReplay.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelReplay.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/PanelScroll.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PanelScroll.tla` | TLA+ | - | - | 5 of 5 actions | - | - | - |
| `specs/Places.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Places.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/PlaybackAnchor.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PlaybackAnchor.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/PlaybackAnchor_Progress.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PlaybackPreference.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PlaybackPreference.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/Player.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Player.tla` | TLA+ | - | - | 7 of 7 actions | - | - | - |
| `specs/PointFocus.cfg` | TLC config | - | - | - | - | - | - |
| `specs/PointFocus.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/ProjectGuide.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ProjectGuide.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/QuietTerminals.cfg` | TLC config | - | - | - | - | - | - |
| `specs/QuietTerminals.tla` | TLA+ | - | - | 7 of 7 actions | - | - | - |
| `specs/QuietTerminals_Visible.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingGesture.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingGesture.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/ReadingHold.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingHold.tla` | TLA+ | - | - | 7 of 7 actions | - | - | - |
| `specs/ReadingSkip.cfg` | TLC config | - | - | - | - | - | - |
| `specs/ReadingSkip.tla` | TLA+ | - | - | 5 of 5 actions | - | - | - |
| `specs/Rehearsal.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Rehearsal.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/Reload.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Reload.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/Resume.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Resume.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/RunBox.cfg` | TLC config | - | - | - | - | - | - |
| `specs/RunBox.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/Scroll.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Scroll.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/Serialize.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Serialize.tla` | TLA+ | - | - | 13 of 13 actions | - | - | - |
| `specs/SettingsAccess.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SettingsAccess.tla` | TLA+ | - | - | 2 of 2 actions | - | - | - |
| `specs/SpeechPage.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechPage.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/SpeechSettings.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechSettings.tla` | TLA+ | - | - | 11 of 11 actions | - | - | - |
| `specs/SpeechSetup.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechSetup.tla` | TLA+ | - | - | 9 of 9 actions | - | - | - |
| `specs/SpeechWorker.cfg` | TLC config | - | - | - | - | - | - |
| `specs/SpeechWorker.tla` | TLA+ | - | - | 8 of 8 actions | - | - | - |
| `specs/Start.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Start.tla` | TLA+ | - | - | 12 of 12 actions | - | - | - |
| `specs/StructuralTyping.cfg` | TLC config | - | - | - | - | - | - |
| `specs/StructuralTyping.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/TerminalPanel.cfg` | TLC config | - | - | - | - | - | - |
| `specs/TerminalPanel.tla` | TLA+ | - | - | 5 of 5 actions | - | - | - |
| `specs/TerminalReuse.cfg` | TLC config | - | - | - | - | - | - |
| `specs/TerminalReuse.tla` | TLA+ | - | - | 3 of 3 actions | - | - | - |
| `specs/Terminals.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Terminals.tla` | TLA+ | - | - | 12 of 12 actions | - | - | - |
| `specs/Timeline.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Timeline.tla` | TLA+ | - | - | 12 of 12 actions | - | - | - |
| `specs/Turns.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Turns.tla` | TLA+ | - | - | 6 of 6 actions | - | - | - |
| `specs/Typing.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Typing.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/TypingEol.cfg` | TLC config | - | - | - | - | - | - |
| `specs/TypingEol.tla` | TLA+ | - | - | 0 of 0 actions | - | - | - |
| `specs/Wire.cfg` | TLC config | - | - | - | - | - | - |
| `specs/Wire.tla` | TLA+ | - | - | 15 of 15 actions | - | - | - |
| `specs/check.sh` | Shell | - | - | - | - | - | - |
| `vitest.config.ts` | TypeScript | - | - | - | - | - | - |
