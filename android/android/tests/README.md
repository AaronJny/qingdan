# Native checks

## Pure Java host tests

From `android/`, run `JAVA_HOME=/path/to/jdk ./test-security.sh`. This covers strict endpoint/asset/API path policy, CSP boundaries, safe filenames/MIME, bounded Base64 URL compatibility, and nonce/chunk/replay/cancel/overflow/truncation export checks. No Android SDK or external test framework is needed.

## Local store policy and real engine

`LocalStorePolicyTest.java` exercises SQL confinement, typed parameter lexer, object key rules and unchanged migration parsing. `BundledSqliteSmokeTest.java` exercises the pinned official SQLite engine rather than a mock, including migrations/JSON, WAL/FULL, rollback, sequential `changes()` guards, `RETURNING`, typed bindings, reopen durability and integrity. Follow the adjacent runner script for exact pinned official JVM dependencies; these tests do not prove Android filesystem/WebView behavior.

## Android instrumentation

`app/src/androidTest/.../LocalStoreInstrumentedTest.java` uses actual bundled SQLite and isolated app-private files. It checks local identity durability/types, SQL transaction behavior, objects/checksums/native image ownership and account/changed-migration rejection.

Build the debug app and test app with `gradle :app:assembleDebug :app:assembleDebugAndroidTest`. This source deliberately sets debug/release signingConfig=null; **both APKs must be signed with the same explicitly authorized key before device installation**. Then install both APKs on a consenting test device/emulator and run:

```
adb shell am instrument -w cn.qingdan.android.test/android.test.InstrumentationTestRunner
```

Do not treat compile success or JVM engine tests as a passed device run. Separate Xiaomi 14 Ultra validation is needed for text entry/IME, app Back/modal order, large export/save cancellation, import cancellation/repeat, pause/resume/lockscreen timer recovery, permission state, offline private-server reopening and endpoint isolation.
