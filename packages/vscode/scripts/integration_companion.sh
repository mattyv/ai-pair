#!/bin/bash
# Runs the installed companion and main extension across two normal windows.
set -euo pipefail
root="$1"
run="$2"
short_tmp="$3"
code="$4"
extension="$5"
shift 5
profile="${run}/companion-restart"
trap 'rm -rf "${profile}"' EXIT
mkdir -p "${profile}/extensions" "${profile}/workspace" "${profile}/probe"
cp "${root}/packages/vscode/test/companion_restart_probe/"* "${profile}/probe/"
(cd "${root}" && npm run build --workspace=packages/audio-ui --silent)
(cd "${root}/packages/vscode" \
  && npx esbuild test/integration_companion_paths.ts \
    --bundle --platform=node --format=cjs --target=node22 --external:vscode \
    --outfile="${profile}/probe/case.cjs" --log-level=warning)
ln -s "${extension}" "${profile}/extensions/michalstrba.ai-pair"
ln -s "${root}/packages/audio-ui" \
  "${profile}/extensions/michalstrba.ai-pair-local-audio"
ln -s "${profile}/probe" \
  "${profile}/extensions/proof.companion-restart-probe"
for stage in prepare verify; do
  result="${profile}/${stage}.json"
  TMPDIR="${short_tmp}" AI_PAIR_HOME="${profile}/home" \
    AI_PAIR_COMPANION_RESTART="${stage}" AI_PAIR_RESTART_RESULT="${result}" \
    CLAUDE_CONFIG_DIR="${profile}/agents/claude" \
    CODEX_HOME="${profile}/agents/codex" \
    XDG_CONFIG_HOME="${profile}/agents/xdg" \
    PULSE_SERVER='unix:/nonexistent' \
    PIPEWIRE_REMOTE='ai-pair-integration-no-audio' \
    PATH='/usr/bin:/bin:/usr/sbin:/sbin' \
    "${code}" "$@" --wait --user-data-dir="${profile}/user" \
    --extensions-dir="${profile}/extensions" \
    --shared-data-dir="${profile}/shared" --disable-workspace-trust \
    --skip-welcome --skip-release-notes "${profile}/workspace" &
  pid=$!
  # The timeout bounds the launcher; wrappers may leave child processes.
  # VSCODE_BIN should name the actual Code binary for reliable cleanup.
  (
    sleep "${AI_PAIR_RESTART_TIMEOUT:-120}" &
    timer=$!
    trap 'kill "${timer}" 2>/dev/null || true; exit 0' TERM
    wait "${timer}"
    kill "${pid}" 2>/dev/null || true
  ) &
  watchdog=$!
  status=0
  wait "${pid}" || status=$?
  kill "${watchdog}" 2>/dev/null || true
  wait "${watchdog}" 2>/dev/null || true
  if ((status != 0)); then
    printf 'Companion %s launch failed (%s)\n' "${stage}" "${status}" >&2
    exit 1
  fi
  if [[ ! -f "${result}" ]] \
    || ! grep -Eq "\"stage\":\"${stage}\",\"ok\":true" "${result}"; then
    printf 'Companion %s did not report success\n' "${stage}" >&2
    exit 1
  fi
  storage="${profile}/user/User/workspaceStorage"
  database=''
  if [[ -d "${storage}" ]]; then
    database="$(find "${storage}" -name state.vscdb -print -quit)"
  fi
  if [[ "${stage}" == prepare ]] && [[ -z "${database}" ]]; then
    printf 'Companion workspace database missing\n' >&2
    exit 1
  fi
done
