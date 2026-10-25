# Updating screenshots

The repository's default [English README](../../README.md) uses the images in `en/`. The [Simplified Chinese README](../../README.zh-CN.md) uses the original images in this directory.

| View | English | 简体中文 |
| --- | --- | --- |
| Task workspace | `en/tasks.jpg` | `tasks.jpg` |
| Monthly calendar | `en/calendar.jpg` | `calendar.jpg` |
| Eisenhower matrix | `en/matrix.jpg` | `matrix.jpg` |
| Habit tracking | `en/habits.jpg` | `habits.jpg` |

## Capture workflow

1. With Node.js 24.22.1 or a newer patched 24.x release, run `npm ci` and `npm run build` in `application/`.
2. Set `QINGDAN_DATA_DIR` to an empty, screenshot-only directory and run `npm start`.
3. Open the local app in a browser. Before adding sample tasks, choose **English** or **简体中文** under **Settings → General → Language** (设置 → 通用 → 语言). Sample content should match the documentation language as well as the interface.
4. Use the light theme and a 1180 × 757 viewport. Open All tasks, Calendar, Eisenhower matrix, and Habits. For the habit view, complete the sample reading goal.
5. Capture the actual running interface, save each image to its language-specific path, and review the pixels for readable text, complete layout, matching language, and absence of personal information. Do not translate or recreate interface text in an image editor.

Keep both language links and screenshot paths working when updating the READMEs.
