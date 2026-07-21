# 前端目录结构

```text
src/shared/
  api.ts                    Command 成功/错误 Zod 合同
  project-events.ts         桌面事件合同与运行时守卫
src/web/
  api-client.ts             唯一 Tauri invoke 边界
  hooks/
    useProjectConsole.ts    项目、URL、操作和 Event 状态
    useTaskCenter.ts        任务聚合筛选与请求代次
  components/               按功能域拆分的页面组件
  App.tsx                   页面组合入口
```

## 规则

- 组件和 Hook 不直接导入 `@tauri-apps/api/core`；Command 统一经过 `api-client.ts`。
- 项目事件只在 `useProjectConsole` 订阅，任务中心不建立第二条监听。
- 共享 DTO/Schema 只在 `src/shared` 定义，不复制到组件或 adapter。
- `src/shared` 不导入 React、Tauri、Node 或浏览器全局对象。
- UI 不直接接触绝对路径读取能力，外部打开也必须走受控 Command。
