# 前端开发规范

## 规范索引

| 规范 | 说明 |
| --- | --- |
| [目录结构](./directory-structure.md) | React、共享合同与 Tauri 边界 |
| [类型安全](./type-safety.md) | IPC 成功/错误 Zod 校验 |
| [质量规范](./quality-guidelines.md) | React、可访问性与验证门禁 |
| [组件规范](./component-guidelines.md) | 功能域组件与文档渲染 |
| [Hook 规范](./hook-guidelines.md) | Command、URL、竞态和 Event 数据流 |
| [状态管理](./state-management.md) | 本地、Core、URL 与派生状态 |
| [只读控制台合同](./readonly-console-contract.md) | 页面行为、桌面事件与响应式验收 |
| [应用更新合同](./application-updater-contract.md) | 更新 IPC、状态机、确认、进度与重启交互 |

## 开发前检查

1. 新增 Command 消费前阅读 `type-safety.md` 和 `readonly-console-contract.md`。
2. 新增组件前阅读 `directory-structure.md` 和 `component-guidelines.md`。
3. 修改异步、URL 或事件同步前阅读 `hook-guidelines.md` 和 `state-management.md`。
4. 修改在线更新 UI、Hook 或 Channel 前阅读 `application-updater-contract.md`。
5. 组件不得直接导入 Tauri API，不因局部需求引入路由、全局状态或组件库。

## 质量检查

- Web 只通过集中客户端调用 Tauri Command，不直接读取文件系统。
- 未知成功响应与错误均在 IPC 边界校验。
- 项目切换不会展示旧详情或正文。
- 任意时刻只有一个活动项目事件订阅。
- 375/768/1024/1440 无页面横向滚动。
- 用户可见文案和代码注释使用中文。
