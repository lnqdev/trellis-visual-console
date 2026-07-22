# 后端日志规范

## 当前实现

- 日志写入固定应用数据目录的 `logs/`，格式为受控 JSONL。
- 单文件上限 2 MiB，总数最多 5 个；轮转后仍严格满足数量和大小边界。
- 日志 API 只接受生命周期枚举、稳定项目 ID、事件类型、监听模式、计数和错误类型。
- 正常生命周期使用 `info`，非致命降级使用 `warn`，初始化或关闭失败使用 `error`。
- `desktop-starting`、`desktop-ready` 和 `desktop-page-loaded` 使用同一进程时钟，可用于计算 Core 初始化和 WebView 页面加载耗时。
- 在线更新只记录检查、发现版本、安装、关闭与重启阶段，以及 `manifest | platform | transport | network | signature | plugin` 等稳定错误类型；不记录版本下载 URL、签名、公钥、私钥或插件错误原文。

## 禁止记录

- 已登记项目或扫描根目录的绝对路径。
- Markdown/JSON/JSONL 正文和命令参数。
- 令牌、密钥、设备标识和个人敏感数据。
- 底层文件系统、Serde、notify 或插件错误原文。
- 堆栈、无结构长期调试输出和遥测上传。

## 验证

压力写入后断言恰好最多 5 个文件、每个不超过 2 MiB；抽查日志不得命中 fixture 绝对路径、正文或命令参数。日志目录只能通过受控 Rust opener 打开。
