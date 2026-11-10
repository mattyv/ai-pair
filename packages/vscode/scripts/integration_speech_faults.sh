#!/bin/bash
# Runs controlled speech boundary cases in separate isolated extension hosts.
set -euo pipefail
root="$1"
run="$2"
short_tmp="$3"
code="$4"
extension="$5"
shift 5
profile="${run}/speech-faults"
trap 'rm -rf "${profile}"' EXIT
(cd "${root}" && npm run build --workspace=packages/audio-ui --silent)
platform="$(uname -s)"
password_args=()
if [[ "${platform}" == Linux ]]; then
  password_args=(--password-store=basic)
fi
for fixture in integration_catalog_paths integration_companion_faults \
  integration_companion_version integration_workspace_incompatible \
  integration_no_workspace integration_restricted_runtime \
  integration_release_extension_owner_paths; do
  if [[ "${platform}" != Linux ]] \
    && [[ "${fixture}" == integration_catalog_paths ||
      "${fixture}" == integration_restricted_runtime ]]; then
    continue
  fi
  mkdir -p "${profile}/${fixture}/extensions" "${profile}/${fixture}/workspace"
  if [[ "${fixture}" == integration_companion_faults ]]; then
    ln -s "${root}/packages/audio-ui" \
      "${profile}/${fixture}/extensions/michalstrba.ai-pair-local-audio"
  fi
  if [[ "${fixture}" == integration_workspace_incompatible ]]; then
    ln -s "${root}/packages/vscode/test/fixtures/incompatible_companion" \
      "${profile}/${fixture}/extensions/michalstrba.ai-pair-local-audio"
  fi
  development="${extension}"
  if [[ "${fixture}" == integration_companion_version ]]; then
    development="${root}/packages/audio-ui"
  fi
  debug_args=()
  if [[ "${fixture}" == integration_companion_version ||
    "${fixture}" == integration_workspace_incompatible ]]; then
    debug_args=(--remote-debugging-port=0)
  fi
  (cd "${root}/packages/vscode" && npx esbuild "test/${fixture}.ts" \
    --bundle --platform=node --format=cjs --target=node22 --external:vscode \
    --outfile="dist-test/${fixture}.js" --log-level=warning)
  workspace_args=()
  if [[ "${fixture}" != integration_no_workspace ]]; then
    workspace_args=("${profile}/${fixture}/workspace")
  fi
  TMPDIR="${short_tmp}" AI_PAIR_HOME="${profile}/${fixture}/home" \
    AI_PAIR_TEST_CDP_FILE="${profile}/${fixture}/user/DevToolsActivePort" \
    PULSE_SERVER='unix:/nonexistent' \
    PIPEWIRE_REMOTE='ai-pair-integration-no-audio' \
    PATH='/usr/bin:/bin:/usr/sbin:/sbin' \
    "${code}" "$@" "${password_args[@]}" "${debug_args[@]}" \
    --user-data-dir="${profile}/${fixture}/user" \
    --shared-data-dir="${profile}/${fixture}/shared" \
    --extensions-dir="${profile}/${fixture}/extensions" \
    --disable-workspace-trust --skip-welcome --skip-release-notes \
    --extensionDevelopmentPath="${development}" \
    --extensionTestsPath="${root}/packages/vscode/dist-test/${fixture}.js" \
    "${workspace_args[@]}"
done
