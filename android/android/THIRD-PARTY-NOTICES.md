# Third-party notices

## AndroidX SQLite

- Pinned dependency: `androidx.sqlite:sqlite-bundled:2.6.2`, with its transitive AndroidX SQLite API and Kotlin runtime dependencies as resolved by Google Maven.
- Copyright: The Android Open Source Project contributors.
- License: Apache License, Version 2.0. The complete license is included at `licenses/Apache-2.0.txt`.
- Source and release information: https://developer.android.com/jetpack/androidx/releases/sqlite
- Source tree: https://android.googlesource.com/platform/frameworks/support/+/androidx-main/sqlite/

This app uses the official bundled native engine through `BundledSQLiteDriver`; it does not load additional SQLite extensions. Standard Android AAR JNI libraries remain packaged for the AAR's supplied ABIs. The final APK must be checked for arm64-v8a (Xiaomi 14 Ultra) and page-size compatibility after build.

## SQLite

SQLite is in the public domain. Upstream notice and blessing: https://www.sqlite.org/copyright.html

The official AndroidX AAR includes SQLite and native integration. Preserve notices and dependency metadata when redistributing the APK/source. Build tools (Gradle, Android Gradle Plugin, JDK, Android SDK) are not application runtime dependencies and retain their own licenses in their distributions.
