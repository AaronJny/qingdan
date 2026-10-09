# 中国大陆调休自动更新：来源、证据与限制

核查日期：2026-10-09。代码不会按每年预填新表，也不会根据普通周末推断尚未公布年度的法定安排。

## 上游来源

- 机器数据：NateScarlet/holiday-cn，固定读取 https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json 。项目 README：https://github.com/NateScarlet/holiday-cn 。JSON Schema：https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/schema.json 。MIT 许可证及作者署名完整保存在 `lib/fixtures/chinese-holiday/LICENSE-holiday-cn.txt`。
- 上游说明年份按国务院文件标题年份归档；下一年通知可能影响前一年十二月。上游的「与周末连休」不代表将额外周末标成法定休假。实现按这两个规则处理。
- 官方证据只使用机器数据 papers 内明确列出的 HTTPS gov.cn 页面，不搜索镜像，不构造备用官方 URL，不自动绕过 403。URL 必须是 gov.cn 或严格的子域边界，不允许凭据、非标准端口、query、fragment 或非 HTML 文档。
- 2026 年官方通知：https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm ，国办发明电〔2025〕7号，落款 2025-11-04。
- 2025 年机器源所列通知：https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm 。现有内置基线已经另行核验过，原有官方链接与 2026-10-07 核验标识原样保留。
- 本次读取的 2027.json 中 papers 和 days 都为空。这表示尚未公布，不表示没有节假日，也不构成未来年度覆盖。

## 信任等级

1. `builtin-baseline`：仅限程序原有、已核验的 2025/2026 基线。机器源中的全部休假日期和补班日期必须逐日完全一致。此路径不需要新增官方 HTTP；不把它声称为“今日重新读取官方正文核验”。该基线的官方源链接继续用于规则溯源。
2. `official-paper`：对新年度或变更年度，获取 papers 官方正文，独立解析年度标题、通知号、落款日期、完整七个全国性节日、每条休假范围和补班日期，再与机器源逐日核对，包括名称、日期、工作/休息标志。全部匹配后才能进入生效缓存。
3. `pending`：机器源合法，但官方证据尚未完成、返回错误、不支持的正文表述、限流或访问受限。候选可供后台排查，绝不传入工作日判定。若该年已有核验缓存，继续使用它。
4. `unpublished`：未来年度 papers/days 同为空。不扩展覆盖。已发布或内置年份变为空时返回 `withdrawal_suspected`，保留原有规则；当前和过去年份空源视为错误。

哈希是响应及证据完整性和版本记录，不是上游数字签名。数据库和后端属于受信边界；对不受信客户端传来的缓存仍需通过完整校验，不能把元数据中的 verification 字段本身视为证明。

## 请求约束

- 默认按照 Asia/Shanghai 当前年计算上一年、当年、下一年，年份随时间滚动。
- 单次最多 3 个机器 JSON 和 1 篇官方正文；串行请求。多篇官方材料未完成时留到下次检查。
- 403 在 `cache.origins[origin]` 记录 blocked/blockedAt。该 origin 后续不再自动请求；不会换域、换 URL 或走镜像重试。此阻断是部署实例运行时状态，不是全球硬编码封禁。
- 429 按 Retry-After 秒数或 HTTP 日期设置 retryAt，并拦住同 origin 的其余年度请求。503 带 Retry-After 时同样处理。无效或缺失 Retry-After 默认至少等待一天。
- ETag/Last-Modified 只在缓存正文与 bodyHash 绑定一致时发送；304 只复用绑定的已保存正文。错误 JSON/正文不会让旧有效内容冒充新版本。
- 每篇官方证据绑定机器 sourceHash。相同机器内容复用已保存证据，不反复抓取公告；机器内容变化时需要新的官方比对。仅官方网站变化、而机器源未变化的修订不会实时发现，这是已知时效限制。缓存的核验时间必须在 UI 明示。
- JSON 上限 128 KiB，官方正文上限 1 MiB，单次超时 15 秒，复用安全 HTTP 层的公开地址校验、DNS 固定、TLS 与重定向约束。
- 实例每天自动/手动冷却、随机错峰、持久全局单并发锁由服务层负责；本模块不创建额外定时器，不做隐式重试。

## 缓存与接入

`refreshChineseHolidays({ cache?, years?, now?, fetcher? })` 返回 `{ cache, results, calendarYears, requests }`。默认直接使用 `safeCalendarFetch`；测试使用注入 fetcher，全套测试无需外网。

- `cache.years`：已通过核验、可生效的年度，保留 sourceUrl/sourceHash/sourceBody、verification、官方证据、lastSuccessAt。
- `cache.pending`：待官方核验的候选机器响应。
- `cache.papers`：官方证据 URL、正文文本及 SHA-256、标题、通知号、落款日期、抓取时间、关联 sourceHash。
- `cache.http` 与 `cache.origins`：按来源保存条件请求与阻断/限流状态；发生失败时也必须持久化。
- `validateChineseHolidayCache` 在重启读取时重验结构、源哈希、证据哈希及逐日一致性，拒绝损坏缓存。
- `chineseHolidayCalendarYears` 生成完整、可序列化的日历覆盖，合并下一年通知中影响本年十二月的条目；仅有下一年十二月片段不能凭空授予本年全年覆盖。
- `installChineseHolidayCache` 供后端使用；`installVerifiedChineseHolidayYears` 供客户端安装服务端已核验快照。现有 2025/2026 内置常量不被改写。
- `getChineseHolidayYears` 和 `getChineseHolidayCoverage` 提供合并后的动态覆盖。直接使用旧的 CHINESE_HOLIDAY_YEARS 常量只会看到内置基线。
- HTTP/API 只暴露必要的来源 URL、哈希、证据元信息、状态、核验时间和可生效规则。机器原文和官方正文留在后端私有缓存，不随一般设置响应传出。

## 明确不支持与失败策略

只覆盖中国大陆全国全体公民节日安排；不包含地方假期、少数民族假期、个人单位排班、半天假或调休预测。支持公历 2000–2100 年的源结构校验，并不意味着这些年都已公布或已被程序核验。

解析器仅接受可完整解释的国务院办公厅年度通知常见格式：完整节日条目、连续休假范围、单日休假、补班日期列表、同月省略月份、显式跨年日期、与周末连休及不调休说明。未知格式、缺节日、错落款/标题、超出范围、冲突、未支持的补充通知/临时延长安排均拒绝更新并保留缓存；不静默猜测、不忽略无法解释的安排。遇到官方格式变化应扩充解析器和测试，而不是每年手填新数据。

## 离线测试证据

`lib/fixtures/chinese-holiday/2025.json`、`2026.json`、`2027-unpublished.json` 是 2026-10-09 读取的原始机器样本。`2026-official.html` 是开发研究时已完成的一次官方 200 响应，仅作为离线测试夹具；另一读取渠道曾返回 403，在获得该限制提示后未再探测官方来源。此测试夹具不会作为产品运行时的“新实时核验”证据。

2027/2028 发布安排的测试样本在测试内由 2026 文本变换构造，并显式标为 synthetic；它们不是实际发布的未来安排，也不会打包为内置覆盖。

测试覆盖：真实 2025/2026 样本、未公布未来年、schema 与重复 JSON 字段/日期、URL 边界、逐日遗漏/增加/错标、跨年十二月、缓存损坏、公告落款/标题/天数、官方不可达、403 持久停止、429 冷却、一次请求预算、304 绑定、防止上游空数据撤回覆盖和缓存回退。
