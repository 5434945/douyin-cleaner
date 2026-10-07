# 抖音清爽刷 · 油猴版 v0.5.0

[在 Greasy Fork 安装](https://greasyfork.org/zh-CN/scripts/599120) · [验证记录](TEST-REPORT.md)

基于 Chrome 扩展 v0.4.5 的独立 Tampermonkey 用户脚本。所有运行代码内置，不使用远程 @require、服务器或 AI 接口。原 Chrome 扩展仍为 v0.4.5，两个版本独立安装和存储。

## 安装

1. 安装官方 Tampermonkey（篡改猴）。
2. 在 Greasy Fork 的脚本页面点击“安装此脚本”，由 Tampermonkey 确认安装。也可在 Tampermonkey 新建脚本，将本目录 `douyin-cleaner.user.js` 的全文粘贴进去并保存。
3. 暂停原“抖音清爽刷”Chrome 扩展，避免两个版本同时切换视频；刷新抖音后进入左侧“推荐”。
4. 点击页面右上角“清爽刷设置”，或在油猴菜单中打开设置。

如果浏览器或 Tampermonkey 提示脚本未获执行权限，请按其提示完成配置。脚本只匹配抖音 HTTPS 网页，不在内嵌框架运行。

## 功能和默认值

- 自动跳过明确广告／推广和直播推荐，默认开启；播放器商品卡、购物入口过滤默认关闭，可单独开启。
- 识别页面标签、已知广告图标，并可选观察抖音网页自身的推荐接口广告字段。接口观察只读取副本，不改写请求或响应；页面沙盒或其他脚本可能影响这项兼容性，页面识别仍独立工作。
- 手动标记当前视频为广告，下次遇到同一稳定视频 ID 时跳过；支持取消标记和名单管理。不能识别重新上传形成的新视频 ID。
- 按稳定作者 ID 管理黑名单和白名单，支持导入／导出。快速拉黑快捷键 `Alt + Shift + B`，开启／暂停快捷键 `Alt + Shift + S`。快捷键只在抖音页面生效，输入时不触发。
- 有依据的华为／鸿蒙智行相关推广作者收集沿用扩展设置，默认开启，可在“管理黑名单”关闭。只在品牌相关且有明确广告标记或商业披露时收集；附作者与作品来源。少量种子名单不是完整 KOC 名册，不证明付费或长期签约关系。
- 本条放行、返回并放行、诊断导出、统计和画面遮挡；不修改播放器静音或音量。

设置、统计、标记和名单保存在用户脚本管理器的本地存储中，不会自动读取原 Chrome 扩展的数据。作者屏蔽仅由脚本跳过推荐内容，不调用抖音原生拉黑。开启作者过滤会跳过黑名单作者的所有推荐内容，移除可撤销。页面结构变化、视频 ID 无法读取、导航失败、白名单、手动操作、输入或弹窗等可能让内容保留。

## 构建和验证

```sh
python userscript/build.py
node --check userscript/douyin-cleaner.user.js
node --test tests/core.test.cjs tests/feed.test.cjs tests/userscript.test.cjs
python tests/userscript-fixture-build.py
node tests/serve.mjs
```

浏览器回归地址：`http://127.0.0.1:8765/tests/userscript-fixture.html`。测试使用完整打包脚本，提供模拟 GM API 及推荐页面地址；不是已安装 Tampermonkey 在真实抖音上的端到端验证。源码与依据见仓库的 REFERENCES.md、BLOCKLIST-SOURCES.md；许可证 MIT。
