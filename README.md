# Qingdan

**English** · [简体中文](README.zh-CN.md)

Qingdan is a task and time management app that runs locally or on your own server, bringing lists, calendars, habits, and focus timers together in one workspace. Use it locally without signing in, or host your own server to sync across devices.

[Download](https://github.com/AaronJny/qingdan/releases/latest) · [Screenshots](#screenshots) · [Using Qingdan](#local-and-self-hosted-modes) · [Backups](#data-and-backups)

## Features

- **Tasks and notes**: Lists, folders, subtasks, checklists, tags, priorities, and rich-text and Markdown descriptions
- **Planning and views**: List, Kanban, calendar, timeline, and Eisenhower matrix views, with dates, times, recurring schedules, and reminder settings
- **Habits and focus**: Habit goals and check-ins, Pomodoro and stopwatch timers, focus history, and statistics
- **Everyday tools**: Templates, countdowns, search, and custom filters
- **Collaboration and attachments**: Self-hosted accounts, shared lists, member permissions, comments, activity feeds, and attachments
- **Data management**: JSON, CSV, and ICS import and export, full backups including attachments, and visible sync status and conflict review

Collaboration requires a self-hosted server running in account mode. Local mode needs no sign-in. Connecting to a server does not automatically upload, merge, or migrate your local data.

### Interface language

The interface supports Simplified Chinese, Traditional Chinese, English, Japanese, Korean, Spanish, French, German, and Brazilian Portuguese. Choose a language or “System default” under “Settings → General → Language”. Unsupported system languages use English.

The language setting applies only to the current device or browser. Tasks and notes keep their original text. Quick-entry date commands support Simplified Chinese and English; you can also use the date picker.

## Agent access

Connect an MCP-compatible agent through the desktop app to selected local or private-server lists. Access is off by default, list-scoped and session-only. See the [Agent access guide](docs/AGENT-ACCESS.md) for setup. Requires v1.3.8 or later on both the desktop app and the connected private server.

## Screenshots

### Task workspace

Schedule tasks by date and organize work and life with lists and tags.

![Qingdan task workspace: all tasks, work and personal lists, tags, and date groups](docs/screenshots/en/tasks.jpg)

<details>
<summary>View calendar, Eisenhower matrix, and habit screenshots</summary>

### Calendar

See scheduled tasks in a monthly calendar, with unscheduled tasks on the right. Drag a task’s body to move it, or its left and right edges to adjust the start and end dates, including across week rows.

![Qingdan calendar: month view, scheduled tasks, and unscheduled tasks](docs/screenshots/en/calendar.jpg)

### Eisenhower matrix

Focus on tasks by priority and date, with configurable rules for each quadrant.

![Qingdan Eisenhower matrix: important and urgent, important but not urgent, urgent but not important, and neither important nor urgent](docs/screenshots/en/matrix.jpg)

### Habit tracking

View daily goals, this week's check-ins, streaks, and completion over the past 30 days.

![Qingdan habits: reading goal, check-in history, and completion rate](docs/screenshots/en/habits.jpg)

</details>

## Download and install

Visit [Releases](https://github.com/AaronJny/qingdan/releases/latest) to download the version for your platform. The current release is [v1.3.8](https://github.com/AaronJny/qingdan/releases/tag/v1.3.8), with desktop, server, and Android builds.

| Platform | Download | Instructions and requirements |
| --- | --- | --- |
| macOS · Apple Silicon | [arm64 DMG](https://github.com/AaronJny/qingdan/releases/download/v1.3.8/Qingdan-1.3.8-mac-arm64.dmg) | macOS 13 or later. Quit the previous version normally, then drag the app into Applications. |
| macOS · Intel | [x64 DMG](https://github.com/AaronJny/qingdan/releases/download/v1.3.8/Qingdan-1.3.8-mac-x64.dmg) | macOS 13 or later. Drag the app into Applications. |
| Windows · x64 | [Portable ZIP](https://github.com/AaronJny/qingdan/releases/download/v1.3.8/Qingdan-1.3.8-win-x64.zip) | Extract the entire archive and run `Qingdan.exe`. Do not copy just the EXE. |
| Linux · x64 | [AppImage](https://github.com/AaronJny/qingdan/releases/download/v1.3.8/Qingdan-1.3.8-linux-x64.AppImage) | Make the file executable before running it. See the [desktop guide](desktop/README.md) for system requirements and launching without FUSE. |
| Self-hosted server / web app | [ZIP with bundled runtimes](https://github.com/AaronJny/qingdan/releases/download/v1.3.8/qingdan-server-v1.3.8.zip) | Includes Linux x64 and macOS arm64 runtimes and launch scripts. No separate Node.js or npm installation is needed. |
| Android | [0.3.7 APK](https://github.com/AaronJny/qingdan/releases/download/v1.3.8/Qingdan-0.3.7-android.apk) | Android 8.0 or later, with an up-to-date system WebView. See the [Android guide](android/README.md) for installation and signing details. |

### Known platform limitations

- The macOS build does not yet have Developer ID signing or Apple notarization, and the Windows build does not yet have a publisher signature. Your system may block the app from running. If you see a security warning, verify the download source first and keep your system's security protections enabled.
- Android updates require the same signing key. Export a full backup before upgrading. Do not uninstall the old app first: uninstalling deletes its private data.
- Reminders and timer sounds require the app page to remain open and visible. Android does not currently support background push notifications or exact alarms.

## Local and self-hosted modes

### Use locally

The desktop app starts its built-in server automatically. There is no need to install Node.js, run commands manually, or enter a username and password. Tasks and attachments are stored in your local user directory.

You can also use the server ZIP as a local web app. After extracting it, read the instructions in the root directory. Run `start.command` on macOS or `start.sh` on Linux, then open the local address in your browser while the server is running.

Local mode is for this device only. Use a server in account mode for access from other devices.

### Connect to your own server

After deploying a server in account mode, enter its address in the desktop app under “Settings → Account & sync → Server connection” or the “File → Server connection” menu (`Cmd/Ctrl+,`). Then sign in with an account created on that server. Use the HTTPS server address provided by your administrator.

Ask your server administrator to create an account for you. Each server, account, and local mode keeps its own data; switching does not migrate it automatically. To set up your own server, see the [self-hosting guide](application/README.md).

## Data and backups

- **Desktop**: The persistent user directory is `QingdanDesktop` under your system's application data directory. Its `local-data` subdirectory contains the local database and attachments. Quit the app normally before copying the entire user directory for a backup, and preserve this directory when upgrading.
- **Standalone server**: Stop the server before copying the entire data directory. Do not back up only the database file or share a data directory between local and account modes.
- **Android**: Uninstalling the app or clearing its data in system settings deletes its private data. Export a full backup from the app beforehand.
- In-app task exports do not include login passwords or sessions. Instance directory backups may contain private information such as accounts and sessions, so store them securely.

## License

Qingdan is licensed under [AGPL-3.0-only](LICENSE). Distribution and modified network services must comply with its source-sharing requirements. See the [licensing guide](application/docs/LICENSING.md) for details and third-party notices.

For contributors and server administrators: [development and deployment documentation](docs/DEVELOPMENT.md).
