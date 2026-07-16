# 数据库规范

## 首版决策

Trellis Visual Console 首版不引入数据库、ORM、迁移工具或独立数据库进程。

原因：

- 源项目 `.trellis/` 已经是事实来源。
- 应用只需要保存小型项目注册表和可重建摘要快照。
- 版本化 JSON 足以满足当前数据规模和个人本机使用场景。

## 当前持久化方案

- `registry.json` 保存项目注册信息。
- `snapshots.json` 保存可重建摘要缓存。
- 具体合同见 [本机存储合同](./local-storage-contract.md)。

## 禁止模式

- 禁止为了注册表或缓存提前引入 SQLite、PostgreSQL、MySQL 等数据库。
- 禁止把历史快照升级为独立事实来源并反向覆盖项目 `.trellis/`。
- 如果未来数据规模或查询需求确实要求数据库，必须建立独立 Trellis 任务，设计迁移、回滚和删除应用数据的行为。
