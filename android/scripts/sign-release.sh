#!/usr/bin/env bash
# Signs only with user-supplied, explicitly approved GitHub secret inputs.
# Never creates a key or installs/configures persistent credentials.
set -euo pipefail

required=(ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD)
missing=()
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if (( ${#missing[@]} )); then
  printf 'Android signing is not configured. Missing GitHub secret names: %s\n' "${missing[*]}" >&2
  printf 'The repository owner must securely configure an approved dedicated signing identity. Do not publish the unsigned APK as installable.\n' >&2
  exit 2
fi
if [[ "${1:-}" == '--check-env' ]]; then
  echo 'Required Android signing secret inputs are present. No key was decoded and no APK was signed.'
  exit 0
fi
[[ $# == 2 ]] || { echo 'Usage: bash scripts/sign-release.sh unsigned.apk signed.apk (or --check-env)' >&2; exit 2; }
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
tools="${QINGDAN_ANDROID_BUILD_TOOLS:-${sdk:+$sdk/build-tools/36.0.0}}"
[[ -n "$tools" && -x "$tools/zipalign" && -x "$tools/apksigner" ]] || { echo 'Preinstalled, already accepted Android SDK Build Tools36.0.0 are required.' >&2; exit 2; }
[[ -f "$1" && "$1" != "$2" ]] || { echo 'Provide distinct existing unsigned input and signed output APK paths.' >&2; exit 2; }
[[ ! -e "$2" ]] || { echo 'Signed output already exists; use a fresh output path.' >&2; exit 2; }
mkdir -p "$(dirname "$2")"
umask 077
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/qingdan-signing.XXXXXX")"
trap 'rm -rf "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$work/signing.keystore"
[[ -s "$work/signing.keystore" ]] || { echo 'Supplied Android signing keystore is empty.' >&2; exit 2; }
"$tools/zipalign" -P 16 -f 4 "$1" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$work/signing.keystore" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD \
  --min-sdk-version 26 --v1-signing-enabled false --v2-signing-enabled true \
  --v3-signing-enabled true --v4-signing-enabled false --out "$work/$(basename "$2")" "$work/aligned.apk"
python3 "$(dirname "$0")/verify-apk.py" "$work/$(basename "$2")" --build-tools "$tools" \
  --report "$work/verification.json"
# Publish only after every real verification gate passes. Failed candidates stay
# in the temporary directory and are removed by the exit trap.
mv "$work/$(basename "$2")" "$2"
mv "$work/verification.json" "$2.verification.json"
