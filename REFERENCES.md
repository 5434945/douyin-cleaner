# 实现参考与验证来源

本插件为独立实现，未复制、分发以下项目的源码。以下项目用于了解常见页面信号和自动切换方式。

1. Frequenk / douyin-enhancer-userscript（GPL-3.0）
   https://github.com/Frequenk/douyin-enhancer-userscript
   参考点：`feed-active-video` 活动播放器、作者区 `svg[viewBox="0 0 30 16"]` 特征、可见直播入口、方向键切换及切换结果确认。作者信息区 SVG 在本插件中为可关闭的兼容规则，不作为稳定接口保证。

2. 抖音自动跳过广告和直播 V2.1（标注 MIT）
   https://greasyfork.org/zh-CN/scripts/569561-抖音自动跳过广告和直播-v2-1/code
   参考点：`feed-item`、`feed-live`、`ad-link`；当前卡片范围检测、切换锁和回看。

3. YU-1021 / better-douyin（MIT）
   https://github.com/YU-1021/better-douyin
   参考点：语义选择器、MutationObserver。未使用该项目的登录弹窗移除或搜索重定向功能。

4. Chrome 官方文档
   https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
   https://developer.chrome.com/docs/extensions/reference/api/storage
   用途：Manifest V3 页面脚本、默认隔离环境和本地存储。

5. 当前抖音推荐页直接 DOM 检查（2026-10-06）
   https://www.douyin.com/?recommend=1
   已观察到 `data-e2e="feed-item"`、`feed-active-video`、`data-e2e-vid`、`video-info`、`feed-video-nickname`、`video-desc`、`video-avatar`、`data-e2e="slideList"`、`video-switch-next-arrow`、`video-switch-prev-arrow`。
   注意：普通视频也含 `live-avatar`；不能用这个节点推断当前是直播。检查页面中未完成真实广告和直播卡片的完整覆盖验证。
   v0.1.2 复查：同账号推荐页还观察到普通视频的作者头像链接直接指向 `live.douyin.com/房间号`，并显示 LiveIcon。因此房间链接或 LiveIcon 本身不作为当前内容是直播的判断依据。本次未捕获用户反馈的真实直播推荐结构；新增兼容规则依据代码审核及本地复现，验证范围详见 TEST-REPORT.md。

6. Chrome 官方 Manifest 内容脚本文档
   https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
   用途：document_start 与 MAIN 环境；原有页面操作留在隔离环境。

7. Johnserf-Seed / TikTokDownload 的 APIv1.0 Wiki
   https://github.com/Johnserf-Seed/TikTokDownload/wiki/APIv1.0
   2023 年历史资料，展示推荐接口 `/aweme/v1/web/tab/feed/`、`aweme_list`、`aweme_id` 和 `is_ads`。仅用严格布尔广告标记作为补充信号，不能保证当前账号仍返回这些字段。

8. Chrome declarativeNetRequest 官方文档
   https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
   评估结果：可匹配请求并阻断，但不能按推荐 JSON 中的广告条目选择性删除响应内容。v0.2.0 未加入此权限或阻断规则，避免误伤共用推荐请求。

9. 当前抖音推荐页直接 DOM 检查（2026-10-07）
   https://www.douyin.com/?recommend=1
   在已渲染的汽车广告作者区观察到 `.account > svg`，viewBox 为 `0 0 30 16`，由 path 绘制“广告”，没有 DOM 文本；昵称真实文字在 `.account-name-text` 内。v0.3.1 增加该已观察字形的匹配和昵称文字之外的独立标签支持。用户截图中的魔兽世界广告已离开当前推荐页，未核实同一条广告的 DOM；不据此断言其具体漏跳原因。
