#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
JAVAC="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
JAVA="${JAVA_HOME:+$JAVA_HOME/bin/}java"
command -v "$JAVAC" >/dev/null || { echo 'A JDK (not just a JRE) is required. Set JAVA_HOME to JDK 17+.' >&2; exit 1; }
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
"$JAVAC" -d "$out" app/src/main/java/cn/qingdan/android/OriginPolicy.java app/src/main/java/cn/qingdan/android/ExportPayload.java app/src/main/java/cn/qingdan/android/ExportBuffer.java app/src/test/java/cn/qingdan/android/SecurityPolicyTest.java
"$JAVA" -Xmx256m -cp "$out" cn.qingdan.android.SecurityPolicyTest
