#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/chatgpt-oracle-review.sh [options] [-- <extra-oracle-args...>]

Packages a fresh audit ZIP, optionally assembles preset review prompt content, and opens ChatGPT via
Oracle browser mode with model/extended-thinking defaults.

Options:
  --preset <name[,name...]>   Preset(s) to include. Repeatable. (default: none)
  --list-presets              Print available preset names and exit
  --dry-run                   Print planned Oracle command without launching
  --                          Pass remaining args directly to Oracle
  -h, --help                  Show this help text

Presets:
  all
  security
  reliability
  cli-contracts
  test-gaps

Examples:
  scripts/chatgpt-oracle-review.sh
  scripts/chatgpt-oracle-review.sh reliability
  scripts/chatgpt-oracle-review.sh --preset security
  scripts/chatgpt-oracle-review.sh --preset "security,cli-contracts"
EOF
}

normalize_token() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]'
}

list_presets() {
  cat <<'EOF'
Available presets:
  all                 - Include all audit preset sections.
  security            - Security review for TS CLI attack surfaces.
  reliability         - Reliability/idempotency/timeouts/failure-path review.
  cli-contracts       - Command UX/flags/exit-code contract review for agents.
  test-gaps           - Highest-risk missing test coverage review.
EOF
}

contains_preset() {
  local candidate="$1"
  shift
  local existing
  for existing in "$@"; do
    if [ "$existing" = "$candidate" ]; then
      return 0
    fi
  done
  return 1
}

add_preset() {
  local candidate="$1"
  if ! contains_preset "$candidate" "${selected_presets[@]-}"; then
    selected_presets+=("$candidate")
  fi
}

expand_preset_token() {
  local token="$1"
  case "$token" in
    all)
      add_preset security
      add_preset reliability
      add_preset cli-contracts
      add_preset test-gaps
      ;;
    security)
      add_preset security
      ;;
    reliability)
      add_preset reliability
      ;;
    cli-contracts)
      add_preset cli-contracts
      ;;
    test-gaps)
      add_preset test-gaps
      ;;
    *)
      echo "Error: unknown preset '$token'." >&2
      echo "Run --list-presets to see valid names." >&2
      exit 1
      ;;
  esac
}

preset_file() {
  local preset="$1"
  case "$preset" in
    security)
      printf '%s\n' "$preset_dir/security.md"
      ;;
    reliability)
      printf '%s\n' "$preset_dir/reliability.md"
      ;;
    cli-contracts)
      printf '%s\n' "$preset_dir/cli-contracts.md"
      ;;
    test-gaps)
      printf '%s\n' "$preset_dir/test-gaps.md"
      ;;
    *)
      echo "Error: no prompt file mapping for preset '$preset'." >&2
      exit 1
      ;;
  esac
}

print_command() {
  local arg
  printf 'Running:'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

require_file() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "Error: required file not found: $path" >&2
    exit 1
  fi
}

run_keychain_preflight() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi
  if ! command -v security >/dev/null 2>&1; then
    return 0
  fi
  echo "Running macOS keychain preflight for Chrome cookie access..."
  if security find-generic-password -w -a "Chrome" -s "Chrome Safe Storage" >/dev/null 2>&1; then
    echo "Keychain preflight: ok"
    return 0
  fi
  echo "Warning: keychain preflight could not confirm Chrome Safe Storage access." >&2
  echo "If prompted, choose \"Always Allow\" to avoid Oracle cookie timeout failures." >&2
  return 0
}

is_remote_chrome_ready() {
  local port="$1"
  curl -sSf "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1
}

start_remote_chrome() {
  local chrome_bin="$1"
  local user_data_dir="$2"
  local profile_dir="$3"
  local port="$4"
  local log_path="$5"

  mkdir -p "$user_data_dir"
  "$chrome_bin" \
    --user-data-dir="$user_data_dir" \
    --profile-directory="$profile_dir" \
    --remote-debugging-port="$port" \
    --new-window "https://chatgpt.com" \
    >>"$log_path" 2>&1 &
}

detect_chrome_last_used_profile() {
  local local_state="$HOME/Library/Application Support/Google/Chrome/Local State"
  local profile=""

  if [ ! -f "$local_state" ]; then
    return 1
  fi

  if command -v jq >/dev/null 2>&1; then
    profile="$(jq -r '.profile.last_used // .profile.last_active_profiles[0] // .profile.profiles_order[0] // empty' "$local_state" 2>/dev/null || true)"
  fi

  if [ -n "$profile" ] && [ "$profile" != "null" ]; then
    printf '%s\n' "$profile"
    return 0
  fi

  printf '%s\n' "Default"
  return 0
}

find_chrome_browser_binary() {
  local candidate

  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta" \
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  for candidate in google-chrome google-chrome-stable chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done

  return 1
}

model="gpt-5.2-pro"
thinking="extended"
name_prefix="cobuild-build-bot-chatgpt-audit"
out_dir=""
include_tests=0
include_docs=1
chatgpt_url=""
oracle_bin=""
browser="chrome"
browser_profile=""
browser_chrome_path=""
browser_manual_login=0
manual_login_fallback=0
browser_cookie_wait="5s"
keychain_timeout_ms="${ORACLE_KEYCHAIN_PROBE_TIMEOUT_MS:-10000}"
oracle_force=1
keychain_preflight=0
remote_managed=1
remote_port="9222"
remote_user_data_dir="$HOME/.oracle/remote-chrome"
remote_profile="Default"
dry_run=0
list_only=0

declare -a selected_presets
declare -a preset_inputs
declare -a extra_prompt_files
declare -a oracle_extra_args
declare -a extra_prompt_chunks

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preset)
      if [ "$#" -lt 2 ]; then
        echo "Error: --preset requires a value." >&2
        exit 1
      fi
      preset_inputs+=("$2")
      shift 2
      ;;
    --list-presets)
      list_only=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do
        oracle_extra_args+=("$1")
        shift
      done
      break
      ;;
    *)
      if [[ "$1" == -* ]]; then
        echo "Error: unknown option '$1'." >&2
        echo "Tip: pass advanced Oracle flags after '--' to forward them directly." >&2
        usage >&2
        exit 1
      fi
      # Positional preset shorthand: `review:gpt reliability,security`
      preset_inputs+=("$1")
      shift
      ;;
  esac
done

if [ "$list_only" -eq 1 ]; then
  list_presets
  exit 0
fi

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Error: not inside a git repository." >&2
  exit 1
fi

resolved_browser_chrome_path="$browser_chrome_path"
resolved_browser_profile="$browser_profile"
if ! resolved_browser_chrome_path="$(find_chrome_browser_binary)"; then
  echo "Error: no Chrome executable was found." >&2
  exit 1
fi

if [ -z "$resolved_browser_profile" ]; then
  detected_profile="$(detect_chrome_last_used_profile || true)"
  if [ -n "$detected_profile" ]; then
    resolved_browser_profile="$detected_profile"
  fi
fi

if [ "$remote_managed" -eq 1 ]; then
  browser_manual_login=0
  keychain_preflight=0
fi

preset_dir="$ROOT/scripts/chatgpt-review-presets"
package_script="$ROOT/scripts/package-audit-context.sh"

require_file "$package_script"

if [ -n "${preset_inputs[*]-}" ]; then
  for raw_input in "${preset_inputs[@]}"; do
    IFS=',' read -r -a preset_tokens <<<"$raw_input"
    for token in "${preset_tokens[@]}"; do
      token="$(normalize_token "$token")"
      if [ -n "$token" ]; then
        expand_preset_token "$token"
      fi
    done
  done

  if [ -z "${selected_presets[*]-}" ]; then
    echo "Error: no presets selected after parsing --preset input." >&2
    exit 1
  fi
fi

declare -a package_cmd
package_cmd=("$package_script" --zip --name "$name_prefix")

if [ -n "$out_dir" ]; then
  package_cmd+=(--out-dir "$out_dir")
fi
if [ "$include_tests" -eq 1 ]; then
  package_cmd+=(--with-tests)
fi
if [ "$include_docs" -eq 0 ]; then
  package_cmd+=(--no-docs)
fi

package_output="$("${package_cmd[@]}")"
printf '%s\n' "$package_output"

zip_path="$(printf '%s\n' "$package_output" | sed -n 's/^ZIP: \(.*\) (.*)$/\1/p' | tail -n1)"
if [ -z "$zip_path" ] || [ ! -f "$zip_path" ]; then
  echo "Error: could not locate generated ZIP path from packaging output." >&2
  exit 1
fi

prompt_path="${zip_path%.zip}.prompt.md"
if [ -n "${selected_presets[*]-}" ] || [ -n "${extra_prompt_files[*]-}" ] || [ -n "${extra_prompt_chunks[*]-}" ]; then
  {
    for token in "${selected_presets[@]-}"; do
      if [ -z "$token" ]; then
        continue
      fi
      preset_path="$(preset_file "$token")"
      require_file "$preset_path"
      cat "$preset_path"
      echo
    done

    for token in "${extra_prompt_files[@]-}"; do
      if [ -z "$token" ]; then
        continue
      fi
      require_file "$token"
      cat "$token"
      echo
    done

    for token in "${extra_prompt_chunks[@]-}"; do
      if [ -z "$token" ]; then
        continue
      fi
      printf '%s\n' "$token"
      echo
    done
  } >"$prompt_path"
  prompt_text="$(<"$prompt_path")"
else
  : >"$prompt_path"
  # Oracle browser mode rejects empty/whitespace prompts; use a minimal placeholder.
  prompt_text="."
fi

declare -a oracle_launcher
if [ -n "$oracle_bin" ]; then
  oracle_launcher=("$oracle_bin")
elif command -v oracle >/dev/null 2>&1; then
  oracle_launcher=("oracle")
elif command -v npx >/dev/null 2>&1; then
  oracle_launcher=("npx" "-y" "@steipete/oracle")
else
  echo "Error: oracle is not installed and npx is unavailable." >&2
  echo "Install oracle or ensure npx is available, then retry." >&2
  exit 1
fi

declare -a oracle_cmd
oracle_cmd=(
  "${oracle_launcher[@]}"
  --engine browser
  --model "$model"
  --browser-model-strategy select
  --browser-thinking-time "$thinking"
  --browser-attachments always
  --browser-cookie-wait "$browser_cookie_wait"
  --prompt "$prompt_text"
  --file "$zip_path"
)

if [ -n "$resolved_browser_chrome_path" ]; then
  oracle_cmd+=(--browser-chrome-path "$resolved_browser_chrome_path")
fi

if [ -n "$resolved_browser_profile" ]; then
  oracle_cmd+=(--browser-chrome-profile "$resolved_browser_profile")
fi

if [ "$browser_manual_login" -eq 1 ]; then
  oracle_cmd+=(--browser-manual-login)
fi

if [ -n "$chatgpt_url" ]; then
  oracle_cmd+=(--chatgpt-url "$chatgpt_url")
fi

if [ -n "${oracle_extra_args[*]-}" ]; then
  oracle_cmd+=("${oracle_extra_args[@]}")
fi

if [ "$remote_managed" -eq 1 ]; then
  oracle_cmd+=(--remote-chrome "127.0.0.1:${remote_port}" --browser-no-cookie-sync)
fi

force_enabled="$oracle_force"
for arg in "${oracle_extra_args[@]-}"; do
  if [ "$arg" = "--force" ]; then
    force_enabled=1
    break
  fi
done

if [ "$oracle_force" -eq 1 ]; then
  oracle_cmd+=(--force)
fi

if [ -n "${selected_presets[*]-}" ]; then
  echo "Prompt presets: ${selected_presets[*]}"
else
  echo "Prompt presets: (none; upload-only prompt)"
fi
echo "Prompt file: $prompt_path"
echo "ZIP file: $zip_path"
echo "Browser target: $browser"
echo "Browser cookie wait: $browser_cookie_wait"
echo "Keychain timeout (ms): $keychain_timeout_ms"
if [ "$force_enabled" -eq 1 ]; then
  echo "Oracle force mode: enabled"
fi
if [ "$browser_manual_login" -eq 1 ]; then
  echo "Manual login mode: enabled"
elif [ "$manual_login_fallback" -eq 1 ]; then
  echo "Manual login fallback: enabled (auto-retry on cookie-sync failure)"
else
  echo "Manual login fallback: disabled"
fi
if [ "$remote_managed" -eq 1 ]; then
  echo "Remote managed mode: enabled"
  echo "Remote Chrome endpoint: 127.0.0.1:${remote_port}"
  echo "Remote user-data-dir: $remote_user_data_dir"
  echo "Remote profile: $remote_profile"
fi
if [ -n "$resolved_browser_chrome_path" ]; then
  echo "Browser binary: $resolved_browser_chrome_path"
fi
if [ -n "$resolved_browser_profile" ]; then
  echo "Browser profile: $resolved_browser_profile"
fi

if [ "$dry_run" -eq 1 ]; then
  echo "Env: ORACLE_KEYCHAIN_PROBE_TIMEOUT_MS=$keychain_timeout_ms"
  echo "Env: ORACLE_COOKIE_LOAD_TIMEOUT_MS=$keychain_timeout_ms"
  print_command "${oracle_cmd[@]}"
  if [ "$manual_login_fallback" -eq 1 ] && [ "$browser_manual_login" -eq 0 ]; then
    echo "Fallback: retries once with --browser-manual-login if cookie sync fails."
  fi
  exit 0
fi

if [ "$remote_managed" -eq 1 ]; then
  remote_log="${TMPDIR:-/tmp}/chatgpt-review-remote-chrome.log"
  if ! is_remote_chrome_ready "$remote_port"; then
    echo "Starting managed remote Chrome on port $remote_port..."
    start_remote_chrome "$resolved_browser_chrome_path" "$remote_user_data_dir" "$remote_profile" "$remote_port" "$remote_log"
    ready=0
    for _ in $(seq 1 50); do
      if is_remote_chrome_ready "$remote_port"; then
        ready=1
        break
      fi
      sleep 0.2
    done
    if [ "$ready" -ne 1 ]; then
      echo "Error: managed remote Chrome failed to start on 127.0.0.1:$remote_port." >&2
      echo "Check log: $remote_log" >&2
      exit 1
    fi
  fi
fi

if [ "$browser_manual_login" -eq 0 ] && [ "$keychain_preflight" -eq 1 ]; then
  run_keychain_preflight
fi

export ORACLE_KEYCHAIN_PROBE_TIMEOUT_MS="$keychain_timeout_ms"
export ORACLE_COOKIE_LOAD_TIMEOUT_MS="$keychain_timeout_ms"
print_command "${oracle_cmd[@]}"
oracle_run_log="$(mktemp -t chatgpt-oracle-review.XXXXXX.log)"
set +e
"${oracle_cmd[@]}" 2>&1 | tee "$oracle_run_log"
oracle_status=${PIPESTATUS[0]}
set -e

if [ "$oracle_status" -eq 0 ]; then
  rm -f "$oracle_run_log"
  exit 0
fi

if grep -q "A session with the same prompt is already running" "$oracle_run_log"; then
  if [ "$force_enabled" -eq 0 ]; then
    echo "Duplicate Oracle session detected; retrying once with --force."
    retry_cmd=("${oracle_cmd[@]}" --force)
    print_command "${retry_cmd[@]}"
    set +e
    "${retry_cmd[@]}"
    retry_status=$?
    set -e
    rm -f "$oracle_run_log"
    exit "$retry_status"
  fi
fi

if grep -q "No ChatGPT cookies were applied from your Chrome profile" "$oracle_run_log"; then
  if [ "$manual_login_fallback" -eq 1 ] && [ "$browser_manual_login" -eq 0 ]; then
    echo "Cookie sync failed; retrying once with --browser-manual-login (persistent profile, no Chrome keychain read)."
    retry_cmd=("${oracle_cmd[@]}" --browser-manual-login)
    print_command "${retry_cmd[@]}"
    set +e
    "${retry_cmd[@]}"
    retry_status=$?
    set -e
    rm -f "$oracle_run_log"
    exit "$retry_status"
  fi
fi

rm -f "$oracle_run_log"
exit "$oracle_status"
