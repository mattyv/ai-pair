#!/usr/bin/env bats
# Tests the normal-window companion restart runner against a fake Code binary.

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export ROOT
  export TEST_RUN="${BATS_TEST_TMPDIR}/run"
  export RECORD="${BATS_TEST_TMPDIR}/record"
  mkdir -p "${TEST_RUN}" "${BATS_TEST_TMPDIR}/bin"
  cat >"${BATS_TEST_TMPDIR}/bin/npm" <<'FAKE'
#!/bin/bash
exit 0
FAKE
  cat >"${BATS_TEST_TMPDIR}/bin/npx" <<'FAKE'
#!/bin/bash
exit 0
FAKE
  cat >"${BATS_TEST_TMPDIR}/bin/code" <<'FAKE'
#!/bin/bash
if [[ "${FAIL_LAUNCH:-}" == 1 ]]; then exit 7; fi
if [[ "${HANG_LAUNCH:-}" == 1 ]]; then exec sleep 30; fi
printf '%s %s %s\n' "${AI_PAIR_COMPANION_RESTART}" "$*" "${NODE_V8_COVERAGE:-}" >>"${RECORD}"
printf '%s\n' "${PULSE_SERVER}" "${PIPEWIRE_REMOTE}" >>"${RECORD}.env"
if [[ "${NO_DATABASE:-}" != 1 ]]; then
  mkdir -p "${TEST_RUN}/companion-restart/user/User/workspaceStorage/id"
  touch "${TEST_RUN}/companion-restart/user/User/workspaceStorage/id/state.vscdb"
fi
if [[ "${FAIL_STAGE:-}" != "${AI_PAIR_COMPANION_RESTART}" ]]; then
  printf '{"stage":"%s","ok":true}' "${AI_PAIR_COMPANION_RESTART}" >"${AI_PAIR_RESTART_RESULT}"
fi
FAKE
  chmod +x "${BATS_TEST_TMPDIR}/bin/npm" "${BATS_TEST_TMPDIR}/bin/npx" "${BATS_TEST_TMPDIR}/bin/code"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
  export NODE_V8_COVERAGE="${BATS_TEST_TMPDIR}/v8"
  CODE="${BATS_TEST_TMPDIR}/bin/code"
}

@test "uses one isolated profile for both normal launches and inherits coverage" {
  run bash "${ROOT}/packages/vscode/scripts/integration_companion.sh" \
    "${ROOT}" "${TEST_RUN}" "${BATS_TEST_TMPDIR}" "${CODE}" \
    "${ROOT}/packages/vscode" --no-sandbox
  [ "${status}" -eq 0 ]
  [ "$(wc -l <"${RECORD}")" -eq 2 ]
  grep -q '^prepare .*--no-sandbox.*companion-restart/user.*companion-restart/workspace' "${RECORD}"
  grep -q '^verify .*--no-sandbox.*companion-restart/user.*companion-restart/workspace' "${RECORD}"
  [ "$(grep -c "${NODE_V8_COVERAGE}" "${RECORD}")" -eq 2 ]
  [ "$(grep -c -- "--shared-data-dir=${TEST_RUN}/companion-restart/shared" "${RECORD}")" -eq 2 ]
  grep -q 'unix:/nonexistent' "${RECORD}.env"
  grep -q 'ai-pair-integration-no-audio' "${RECORD}.env"
}

@test "fails when either stage does not report success" {
  FAIL_STAGE=prepare run bash "${ROOT}/packages/vscode/scripts/integration_companion.sh" \
    "${ROOT}" "${TEST_RUN}" "${BATS_TEST_TMPDIR}" "${CODE}" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
  FAIL_STAGE=verify run bash "${ROOT}/packages/vscode/scripts/integration_companion.sh" \
    "${ROOT}" "${TEST_RUN}" "${BATS_TEST_TMPDIR}" "${CODE}" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
}

@test "requires a persisted workspace database and cleans the profile" {
  NO_DATABASE=1 run bash "${ROOT}/packages/vscode/scripts/integration_companion.sh" \
    "${ROOT}" "${TEST_RUN}" "${BATS_TEST_TMPDIR}" "${CODE}" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
  [[ "${output}" == *"workspace database missing"* ]]
  [ ! -e "${TEST_RUN}/companion-restart" ]
}

@test "fails and cleans up when Code exits unsuccessfully" {
  FAIL_LAUNCH=1 run bash "${ROOT}/packages/vscode/scripts/integration_companion.sh" \
    "${ROOT}" "${TEST_RUN}" "${BATS_TEST_TMPDIR}" "${CODE}" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
  [[ "${output}" == *"launch failed"* ]]
  [ ! -e "${TEST_RUN}/companion-restart" ]
}

@test "bounds a stalled Code launch and cleans up" {
  HANG_LAUNCH=1 AI_PAIR_RESTART_TIMEOUT=1 run bash \
    "${ROOT}/packages/vscode/scripts/integration_companion.sh" \
    "${ROOT}" "${TEST_RUN}" "${BATS_TEST_TMPDIR}" "${CODE}" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
  [[ "${output}" == *"launch failed"* ]]
  [ ! -e "${TEST_RUN}/companion-restart" ]
}
