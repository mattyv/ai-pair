#!/usr/bin/env bats
# scripts/lint_shell.sh on scripts that keep each hand-checked rule, and ones that break each.

bats_require_minimum_version 1.5.0

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export ROOT
  # A repository of its own, so `git ls-files` lists only the test's scripts.
  REPO="${BATS_TEST_TMPDIR}/repo"
  mkdir -p "${REPO}"
  cp "${ROOT}/.shellcheckrc" "${ROOT}/.editorconfig" "${REPO}/"
  git -C "${REPO}" init -q
  export LINT_SHELL_ROOT="${REPO}"
}

good() {
  printf '#!/bin/bash\n# A script that keeps every rule.\nset -u\n\necho "fine"\n' >"${REPO}/$1"
}

@test "passes a script that keeps every rule" {
  good good_script.sh
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 0 ]] || false
}

@test "reports a shebang that is not bash" {
  printf '#!/bin/sh\n# Not bash.\necho "sh"\n' >"${REPO}/sh_script.sh"
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 1 ]] || false
  [[ "${stderr}" == *'sh_script.sh:1: start with #!/bin/bash'* ]] || false
}

@test "reports a file name that is not lowercase with underscores" {
  good Bad-Name.sh
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 1 ]] || false
  [[ "${stderr}" == *'Bad-Name.sh:1: name the file in lowercase, with underscores'* ]] || false
}

@test "reports a line over 80 columns" {
  good long_line.sh
  printf '# %s\n' "$(printf 'x%.0s' {1..90})" >>"${REPO}/long_line.sh"
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 1 ]] || false
  [[ "${stderr}" == *'long_line.sh:6: over 80 columns'* ]] || false
}

@test "reports a script over 100 lines" {
  good long_script.sh
  for _ in $(seq 1 100); do echo '# more' >>"${REPO}/long_script.sh"; done
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 1 ]] || false
  [[ "${stderr}" == *'long_script.sh:101: over 100 lines: rewrite it in another language'* ]] || false
}

@test "passes a bats assertion that ends in || false" {
  good good_script.sh
  mkdir -p "${REPO}/scripts/test"
  printf '@test "x" {\n  [[ 1 -eq 1 ]] || false\n  ((1 == 1)) || false\n  [[ -f a ]] && exit 2\n}\n' \
    >"${REPO}/scripts/test/good.bats"
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 0 ]] || false
}

@test "reports a bats assertion that bash 3.2 would ignore (#112)" {
  good good_script.sh
  mkdir -p "${REPO}/scripts/test"
  printf '@test "x" {\n  [[ 1 -eq 2 ]]\n  ((1 == 2))\n  true\n}\n' >"${REPO}/scripts/test/bad.bats"
  run --separate-stderr bash "${ROOT}/scripts/lint_shell.sh"
  [[ "${status}" -eq 1 ]] || false
  [[ "${stderr}" == *'scripts/test/bad.bats:2: end the assertion with || false'* ]] || false
  [[ "${stderr}" == *'scripts/test/bad.bats:3: end the assertion with || false'* ]] || false
}
