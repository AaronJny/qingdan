# Qingdan

[简体中文](README.md) · [English](README.en.md)

Qingdan is a task and time management app that runs locally or on your own server, bringing lists, calendars, habits, and focus timers together in one workspace. Use it locally without signing in, or host your own server to sync across devices.

[Download](https://github.com/AaronJny/qingdan/releases/latest) · [Screenshots](#screenshots) · [Run from source](#run-from-source) · [Deployment and development docs](#deployment-and-development-docs)

## Features

- **Tasks and notes**: Lists, folders, subtasks, checklists, tags, priorities, and rich-text and Markdown descriptions
- **Planning and views**: List, Kanban, calendar, timeline, and Eisenhower matrix views, with dates, times, recurring schedules, and reminder settings
- **Habits and focus**: Habit goals and check-ins, Pomodoro and stopwatch timers, focus history, and statistics
- **Everyday tools**: Templates, countdowns, search, and custom filters
- **Collaboration and attachments**: Self-hosted accounts, shared lists, member permissions, comments, activity feeds, and attachments
- **Data management**: JSON, CSV, and ICS import and export, full backups including attachments, and visible sync status and conflict review

Collaboration requires a self-hosted server running in account mode. Local mode needs no sign-in. Connecting to a server does not automatically upload, merge, or migrate your local data.

### Interface language

The interface supports Simplified Chinese and English. Choose a language or “System default” under “Settings → Language”; changes take effect immediately. System default uses Simplified Chinese for Chinese system languages and English for all others. Your choice is saved only on the current device or browser and does not sync with your account. Tasks, notes, lists, and tags you create are not translated.

## Screenshots

### Task workspace

Schedule tasks by date and organize work and life with lists and tags.

![Qingdan task workspace: all tasks, work and personal lists, tags, and date groups](docs/screenshots/tasks.jpg)

<details>
<summary>View calendar, Eisenhower matrix, and habit screenshots</summary>

### Calendar

See scheduled tasks in a monthly calendar, with unscheduled tasks on the right.

![Qingdan calendar: month view, scheduled tasks, and unscheduled tasks](docs/screenshots/calendar.jpg)

### Eisenhower matrix

Focus on tasks by priority and date, with configurable rules for each quadrant.

![Qingdan Eisenhower matrix: important and urgent, important but not urgent, urgent but not important, and neither important nor urgent](docs/screenshots/matrix.jpg)

### Habit tracking

View daily goals, this week's check-ins, streaks, and completion over the past 30 days.

![Qingdan habits: reading goal, check-in history, and completion rate](docs/screenshots/habits.jpg)

</details>

## Download and install

Visit [Releases](https://github.com/AaronJny/qingdan/releases/latest) to download the version for your platform. The current release is [v1.2.0](https://github.com/AaronJny/qingdan/releases/tag/v1.2.0), with desktop, server, and Android builds.

| Platform | Download | Instructions and requirements |
| --- | --- | --- |
| macOS · Apple Silicon | [arm64 DMG](https://github.com/AaronJny/qingdan/releases/download/v1.2.0/Qingdan-1.2.0-mac-arm64.dmg) | macOS 13 or later. Quit the previous version normally, then drag the app into Applications. Intel Macs are not currently supported. |
| Windows · x64 | [Portable ZIP](https://github.com/AaronJny/qingdan/releases/download/v1.2.0/Qingdan-1.2.0-win-x64.zip) | Extract the entire archive and run `Qingdan.exe`. Do not copy just the EXE. |
| Linux · x64 | [AppImage](https://github.com/AaronJny/qingdan/releases/download/v1.2.0/Qingdan-1.2.0-linux-x64.AppImage) | Requires a graphical desktop and a working Electron sandbox. Make the file executable before running it. See the [desktop guide](desktop/README.md) for an alternative launch method if FUSE is unavailable. |
| Self-hosted server / web app | [ZIP with bundled runtimes](https://github.com/AaronJny/qingdan/releases/download/v1.2.0/qingdan-server-v1.2.0.zip) | Includes Linux x64 and macOS arm64 runtimes and launch scripts. No separate Node.js or npm installation is needed. |
| Android | [0.2.0 APK](https://github.com/AaronJny/qingdan/releases/download/v1.2.0/Qingdan-0.2.0-android.apk) | Android 8.0 or later, with an up-to-date system WebView. See the [Android guide](android/README.md) for installation and signing details. |

You can verify downloaded files using the SHA256 checksum file included with the release.

### Known platform limitations

- The macOS build does not yet have Developer ID signing or Apple notarization, and the Windows build does not yet have a publisher signature. Your system may block the app from running. If you see a security warning, verify the download source first and keep your system's security protections enabled.
- An Android build signed with a new key cannot be installed over a build signed with a different key. Export a full backup from the old app before upgrading. Do not uninstall it first: uninstalling deletes the app's private data.
- Reminders and timer sounds require the app page to remain open and visible. Android does not currently support background push notifications or exact alarms.

## Local and self-hosted modes

### Use locally

The desktop app starts its built-in server automatically. There is no need to install Node.js, run commands manually, or enter a username and password. Tasks and attachments are stored in your local user directory.

You can also use the server ZIP as a local web app. After extracting it, read the instructions in the root directory. Run `start.command` on macOS or `start.sh` on Linux, then open the local address in your browser while the server is running.

**Local mode without sign-in only allows loopback access. Do not expose it through a reverse proxy, tunnel, or public port.**

### Connect to your own server

After deploying a server in account mode, enter its address in the desktop app under “Settings → Account & sync → Server connection” or the “File → Server connection” menu (`Cmd/Ctrl+,`). Then sign in with an account created on that server. Remote servers require an HTTPS root URL with a valid certificate. The desktop app permits HTTP for literal loopback addresses. Android server connections support HTTPS only.

Account mode has no default password or public sign-up. Initialize the administrator account in an interactive terminal on the deployment machine. Data and caches are isolated across servers, accounts, and local mode; data does not migrate between them automatically. See the [server configuration guide](application/README.md) and [account guide](application/AUTH.md) for deployment steps and HTTPS configuration.

## Run from source

Requires **Node.js 24** and npm. From the repository root, run:

```sh
cd application
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4310`. By default, the app runs in single-user mode accessible only from the local machine. The default data directory is `application/data/local`; set `QINGDAN_DATA_DIR` to use a separate directory.

Return to the repository root and run the full source checks separately:

```sh
npm run check --prefix application
```

See [application/README.md](application/README.md) for self-hosting configuration, environment variables, Docker Compose, and development instructions.

## Data and backups

- **Desktop**: The persistent user directory is `QingdanDesktop` under your system's application data directory. Its `local-data` subdirectory contains the local database and attachments. Quit the app normally before copying the entire user directory for a backup, and preserve this directory when upgrading.
- **Standalone server**: Stop the server before backing up the complete instance data directory, including SQLite data, stored objects, and the mode marker. Do not copy only the main SQLite file while the server is running, or share a data directory between local and account modes.
- **Android**: Uninstalling the app or clearing its data in system settings deletes its private data. Export a full backup from the app beforehand.
- In-app task exports do not include login passwords or sessions. Instance directory backups may contain private information such as accounts and sessions, so store them securely.

## Deployment and development docs

| Directory / document | Contents |
| --- | --- |
| [application/](application/README.md) · [Account guide](application/AUTH.md) | React frontend, Node.js server, database migrations, accounts, and deployment configuration |
| [desktop/](desktop/README.md) · [Build and release guide](desktop/docs/BUILD-RELEASE.md) | Electron desktop wrapper, built-in backend, and platform-specific packaging |
| [android/](android/README.md) · [Signing setup](android/docs/RELEASE-SIGNING.md) | Native Android shell, separate web app source, building, and signing |
| [server-packaging/](server-packaging/BUILD.md) | Server ZIP with bundled runtimes and launch scripts |
| [Brand assets](docs/BRANDING.md) | Green clipboard icons for the web, desktop, and Android apps |
| [Frontend third-party notices](application/docs/THIRD-PARTY-NOTICES.md) · [DMG toolchain notices](desktop/scripts/dmg/toolchain/THIRD-PARTY-NOTICES.md) | Third-party licenses and notices that must be retained when distributing the software |

### Checks and releases

Pushing to `main` runs the [full checks workflow](.github/workflows/check.yml). Release versions are specified in [.github/release/request.json](.github/release/request.json). Release builds run only when the release request changes, a matching version tag is pushed, or the “青单发布” (Qingdan release) workflow is triggered manually. Ordinary commits run checks only.

The release pipeline requires all five builds: macOS, Windows, Linux, server, and Android, along with SHA256 checksums and a separate verification report. If Android signing is not configured, the release remains a draft. Provide signing keys and passwords through secure configuration; never put them in source code, chat, or build artifacts.

## License

The project source code is licensed under **AGPL-3.0-only**. See [LICENSE](LICENSE) for the full text. Commercial use and compliant distribution are permitted. When distributing the software, including binaries, or offering a modified version as a network service, you must provide the corresponding source code to recipients or network users as required by the license. Before deploying or distributing, read the [licensing scope and source delivery guide](application/docs/LICENSING.md).

Third-party dependencies, icon libraries, and build tools remain under their respective licenses; the project's license does not replace them. Retain the applicable licenses and notices when distributing the software. The corresponding source code must be accessible to software recipients or network users.
