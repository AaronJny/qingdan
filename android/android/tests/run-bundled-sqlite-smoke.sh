#!/usr/bin/env bash
# Real Linux JVM SQLite engine check, independent of Android SDK/device verification.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/qingdan-sqlite-smoke.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
JAVAC=${JAVA_HOME:+$JAVA_HOME/bin/}javac
JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}java
fetch() {
  curl --fail --location --retry 2 --max-time 120 --silent --show-error "$1" -o "$WORK/$2"
  printf '%s  %s\n' "$3" "$WORK/$2" | sha256sum --check --status
}
fetch 'https://dl.google.com/dl/android/maven2/androidx/sqlite/sqlite-bundled-jvm/2.6.2/sqlite-bundled-jvm-2.6.2.jar' 'sqlite-bundled.jar' 'e61efb0647288b486e595950724cc53c4f15eeeca03ce2184751d02de3cfaa17'
fetch 'https://dl.google.com/dl/android/maven2/androidx/sqlite/sqlite-jvm/2.6.2/sqlite-jvm-2.6.2.jar' 'sqlite.jar' '53b050b80e666228a12a0ae72d49531b3d69615ba8fb62733f697f8fdc7fd6f3'
fetch 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.jar' 'kotlin-stdlib.jar' 'f31cc53f105a7e48c093683bbd5437561d1233920513774b470805641bedbc09'
mkdir "$WORK/classes"
"$JAVAC" --release 17 -cp "$WORK/*" -d "$WORK/classes" \
  "$ROOT/android/app/src/main/java/cn/qingdan/android/LocalStorePolicy.java" \
  "$ROOT/android/app/src/test/java/cn/qingdan/android/LocalStorePolicyTest.java" \
  "$ROOT/android/tests/BundledSqliteSmokeTest.java"
"$JAVA" -cp "$WORK/classes:$WORK/*" cn.qingdan.android.LocalStorePolicyTest "$ROOT/webapp/drizzle"
"$JAVA" -cp "$WORK/classes:$WORK/*" cn.qingdan.android.BundledSqliteSmokeTest "$ROOT/webapp/drizzle"
