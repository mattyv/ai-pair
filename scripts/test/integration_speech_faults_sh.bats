#!/usr/bin/env bats
# Checks the isolated speech boundary test launcher.
setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export RECORD="${BATS_TEST_TMPDIR}/record"
  mkdir -p "${BATS_TEST_TMPDIR}/bin" "${BATS_TEST_TMPDIR}/run"
  for tool in npm npx; do
    printf '#!/bin/bash\nexit 0\n' >"${BATS_TEST_TMPDIR}/bin/${tool}"
    chmod +x "${BATS_TEST_TMPDIR}/bin/${tool}"
  done
  cat >"${BATS_TEST_TMPDIR}/bin/uname" <<'FAKE'
#!/bin/bash
printf '%s\n' "${TEST_PLATFORM:-Linux}"
FAKE
  chmod +x "${BATS_TEST_TMPDIR}/bin/uname"
  cat >"${BATS_TEST_TMPDIR}/bin/code" <<'FAKE'
#!/bin/bash
printf '%s\n' "$*" >>"${RECORD}"
printf '%s %s %s\n' "${PULSE_SERVER}" "${PIPEWIRE_REMOTE}" "${NODE_V8_COVERAGE:-}" >>"${RECORD}.env"
if [[ "${FAIL_CODE:-}" == 1 ]]; then exit 7; fi
FAKE
  chmod +x "${BATS_TEST_TMPDIR}/bin/code"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
  export NODE_V8_COVERAGE="${BATS_TEST_TMPDIR}/coverage"
}

@test "runs both speech fixtures in separate profiles with isolated storage and no audio" {
  run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode" --no-sandbox
  [ "${status}" -eq 0 ]
  [ "$(wc -l <"${RECORD}")" -eq 4 ]
  grep -q 'integration_catalog_paths.js' "${RECORD}"
  grep -q 'integration_companion_faults.js' "${RECORD}"
  grep -q 'integration_no_workspace.js' "${RECORD}"
  grep -q 'integration_restricted_runtime.js' "${RECORD}"
  ! grep 'integration_no_workspace.js' "${RECORD}" | grep -Fq "${BATS_TEST_TMPDIR}/run/speech-faults/integration_no_workspace/workspace"
  [ "$(grep -c -- '--shared-data-dir=' "${RECORD}")" -eq 4 ]
  [ "$(grep -c -- '--password-store=basic' "${RECORD}")" -eq 4 ]
  [ "$(grep -c "${NODE_V8_COVERAGE}" "${RECORD}.env")" -eq 4 ]
  grep -q 'unix:/nonexistent ai-pair-integration-no-audio' "${RECORD}.env"
  [ ! -e "${BATS_TEST_TMPDIR}/run/speech-faults" ]
}

@test "propagates launch failure and cleans the profile" {
  FAIL_CODE=1 run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
  [ ! -e "${BATS_TEST_TMPDIR}/run/speech-faults" ]
}

@test "skips the Linux-only catalog fixture on macOS" {
  TEST_PLATFORM=Darwin run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -eq 0 ]
  [ "$(wc -l <"${RECORD}")" -eq 2 ]
  ! grep -q 'integration_catalog_paths.js' "${RECORD}"
  ! grep -q -- '--password-store=basic' "${RECORD}"
}


@test "skips Linux-only runtime restriction on macOS" {
  TEST_PLATFORM=Darwin run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -eq 0 ]
  ! grep -q 'integration_restricted_runtime.js' "${RECORD}"
}
