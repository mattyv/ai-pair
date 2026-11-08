#!/usr/bin/env bats
# The CI selector must skip only changes confined to known test directories.

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  cd "${BATS_TEST_TMPDIR}"
  git init -q
  git config user.email test@example.com
  git config user.name Test
  mkdir -p packages/demo/test packages/demo/src packages/vscode/test specs
  echo before >packages/demo/test/demo.test.ts
  echo before >packages/demo/src/demo.ts
  echo before >specs/Demo.tla
  git add .
  git commit -qm initial
  BASE="$(git rev-parse HEAD)"
}

@test "skips a tests-only change" {
  echo after >packages/demo/test/demo.test.ts
  git add . && git commit -qm test
  run bash "${ROOT}/scripts/specs_needed.sh" "${BASE}" HEAD
  [ "${status}" -eq 0 ]
  [ "${output}" = false ]
}

@test "skips the known VS Code integration harness files" {
  echo test >packages/vscode/test/integration.ts
  echo test >packages/vscode/test/integration_preserved_playback.ts
  git add . && git commit -qm integration
  run bash "${ROOT}/scripts/specs_needed.sh" "${BASE}" HEAD
  [ "${status}" -eq 0 ]
  [ "${output}" = false ]
}

@test "runs for source, spec and unknown changes independently" {
  for path in packages/demo/src/demo.ts specs/Demo.tla README.md packages/vscode/test/integration_unknown.ts; do
    git reset --hard -q "${BASE}"
    echo after >"${path}"
    git add . && git commit -qm change
    run bash "${ROOT}/scripts/specs_needed.sh" "${BASE}" HEAD
    [ "${status}" -eq 0 ]
    [ "${output}" = true ]
  done
}

@test "runs for mixed test and source changes" {
  echo after >packages/demo/test/demo.test.ts
  echo after >packages/demo/src/demo.ts
  git add . && git commit -qm mixed
  run bash "${ROOT}/scripts/specs_needed.sh" "${BASE}" HEAD
  [ "${status}" -eq 0 ]
  [ "${output}" = true ]
}

@test "runs for an invalid base and an empty diff" {
  run bash "${ROOT}/scripts/specs_needed.sh" missing HEAD
  [ "${status}" -eq 0 ]
  [ "${output}" = true ]
  run bash "${ROOT}/scripts/specs_needed.sh" HEAD HEAD
  [ "${status}" -eq 0 ]
  [ "${output}" = true ]
}

@test "runs when a test moves into source" {
  mv packages/demo/test/demo.test.ts packages/demo/src/new.ts
  git add -A && git commit -qm move
  run bash "${ROOT}/scripts/specs_needed.sh" "${BASE}" HEAD
  [ "${status}" -eq 0 ]
  [ "${output}" = true ]
}
