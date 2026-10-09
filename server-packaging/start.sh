#!/bin/sh
set -eu
PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) NODE_BIN="$PACKAGE_DIR/runtime/linux-x64/node" ;;
  Darwin:arm64) NODE_BIN="$PACKAGE_DIR/runtime/darwin-arm64/node" ;;
  *) printf '%s\n' '此包支持 Linux x64（glibc）及 Apple Silicon Mac；当前系统/架构不在兼容范围。' >&2; exit 1 ;;
esac
# With no command, keep the instance marker out of the action position.
if [ "$#" -eq 0 ]; then set -- start; fi
INSTANCE_ID=$("$NODE_BIN" --input-type=module -e 'import{randomUUID}from"node:crypto";console.log(randomUUID())')
exec "$NODE_BIN" "$PACKAGE_DIR/launcher/launch-server.mjs" "$@" "--qingdan-instance=$INSTANCE_ID"
