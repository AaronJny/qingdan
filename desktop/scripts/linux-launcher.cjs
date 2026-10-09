'use strict';
// electron-builder 26.15.3's generated AppRun silently disables sandboxing on
// hosts without user namespaces. The afterPack hook supplies this launcher
// instead; builder copies it into the AppDir after generating its own AppRun.
module.exports = `#!/usr/bin/env bash
set -euo pipefail
APPDIR="$(cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd -P)"
for arg in "$@"; do
  case "$arg" in
    --no-sandbox|--no-sandbox=*|--disable-setuid-sandbox|--disable-setuid-sandbox=*|--disable-seccomp-filter-sandbox|--disable-seccomp-filter-sandbox=*)
      echo 'Qingdan requires the Electron sandbox. Sandbox-disabling options are unsupported.' >&2
      exit 1
      ;;
  esac
done
export PATH="$APPDIR:$APPDIR/usr/sbin\${PATH:+:$PATH}"
export XDG_DATA_DIRS="$APPDIR/usr/share\${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}:/usr/local/share:/usr/share"
export LD_LIBRARY_PATH="$APPDIR/usr/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$APPDIR/qingdan" "$@"
`;
