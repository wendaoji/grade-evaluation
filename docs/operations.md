# 运维与企业化能力

## SSO

当前版本提供最小可用的 SSO 接入点：

- `POST /api/auth/sso-login`

支持两种传参方式：

- 请求头 `x-sso-user`
- 查询参数 `username`

该模式适合接在反向代理或企业统一认证网关之后，由外层网关完成真实身份认证，应用内部只做账号映射。

## 监控

当前版本提供基础监控接口：

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`

其中 `/metrics` 返回当前用户数、人员数、批次数、评审数、审计日志数和数据库路径等基础运行信息。

## 备份

可通过接口或脚本备份 SQLite 数据库：

- 接口：`POST /api/admin/backup`
- 脚本：[scripts/backup-db.sh](/Users/wendaoji/workspace/wendaoji/gradeEvaluation/scripts/backup-db.sh)

示例：

```bash
./scripts/backup-db.sh
./scripts/backup-db.sh /custom/backup/dir
```

## 审计

当前版本对以下操作记录审计日志：

- 批次创建与状态切换
- 评价体系更新、导入、模板应用
- 人员新增、更新、批量导入
- 评审保存、提交、通过、驳回
- 数据库备份

查询接口：

- `GET /api/audit-logs`

## PostgreSQL 迁移资产

当前仓库已提供 PostgreSQL 版建表脚本：

- [sql/postgresql-schema.sql](/Users/wendaoji/workspace/wendaoji/gradeEvaluation/sql/postgresql-schema.sql)

当前运行时仍默认使用 SQLite，但数据模型和 SQL 结构已同步给出，便于继续迁移到正式数据库。
