# 新会话交接说明

## 项目路径

`/Users/wanglinqiao/llm/trellis-visual-console`

## 来源

本项目的规划来自 Trellis 仓库任务：

`/Users/wanglinqiao/llm/Trellis/.trellis/tasks/07-15-trellis-visual-console`

源任务仍保留，当前目录中的文档是独立项目的实施依据。

## 建议的新会话首条指令

请先完整阅读：

1. `docs/planning/prd.md`
2. `docs/planning/design.md`
3. `docs/planning/implement.md`
4. `docs/planning/fp-analysis.md`

然后检查当前目录状态，向我汇报你理解的产品边界和第一阶段实施计划。未经确认不要扩大首版范围；不要把 `@mindfoldhq/trellis-core` 设为强制依赖；不要写入任何被浏览项目的 `.trellis/` 数据。

## 会话边界

建议后续实现都在以本目录为工作区的新会话中进行。当前 Trellis 仓库会话继续保留为需求来源和 Trellis 本体调研入口，避免两个独立项目的代码、Git 状态和项目规范混在一个会话里。
