#!/bin/bash
# Run this on your own Mac. Never upload the keystore to source control or chat.
set -euo pipefail
umask 077
if [[ "$#" -ne 1 ]]; then
  printf '%s\n' 'Usage: bash create-release-key-macos.sh /private/backup/location/qingdan-release.p12' >&2
  exit 2
fi
command -v keytool >/dev/null || { printf '%s\n' 'Install an official JDK first (keytool is required).' >&2; exit 1; }
keystore="$1"
[[ ! -e "$keystore" ]] || { printf '%s\n' 'Refusing to replace an existing keystore.' >&2; exit 1; }
[[ -d "$(dirname "$keystore")" ]] || { printf '%s\n' 'Choose an existing private backup directory.' >&2; exit 1; }
printf '%s\n' 'keytool will ask for a password twice. Input is hidden. Keep it in your password manager.'
keytool -genkeypair -storetype PKCS12 -keystore "$keystore" -alias qingdan -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Qingdan Android'
chmod 600 "$keystore"
printf '%s\n' 'Created your release keystore. Keep a second private backup; future updates need the same key.'
printf '%s\n' 'Set ANDROID_KEY_ALIAS to qingdan. Set both ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_PASSWORD to the password you just chose.'
if command -v pbcopy >/dev/null; then
  printf '%s' 'Press Return to copy the keystore base64 to your clipboard for ANDROID_KEYSTORE_BASE64 (or Ctrl+C to leave): '
  read -r _
  base64 < "$keystore" | tr -d '\n' | pbcopy
  printf '\n%s\n' 'Copied. Paste only into the GitHub repository secret field, then clear your clipboard.'
else
  printf '%s\n' 'No macOS clipboard utility found; the keystore was created but not copied.'
fi
