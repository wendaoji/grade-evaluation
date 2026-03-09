# 系统设计说明

## 1. 总体架构

系统采用单体 MVP 架构：

- 前端静态页面负责展示配置、评分和统计界面
- 后端 HTTP 服务提供认证、配置、评分和结果接口
- SQLite 数据库作为持久化存储，首次启动从 JSON 种子导入演示数据
- 支持通过 Docker / Docker Compose 进行单容器部署
- 支持评审工作流、审计日志、SSO 映射登录、健康检查和数据库备份

## 2. 目录结构

```text
gradeEvaluation/
├── data/
│   ├── grade-evaluation.db
│   └── store.json
├── Dockerfile
├── docker-compose.yml
├── docs/
│   ├── api.md
│   ├── architecture.md
│   ├── database-design.md
│   ├── operations.md
│   ├── overview.md
│   ├── requirements.md
│   └── roadmap.md
├── scripts/
│   └── backup-db.sh
├── sql/
│   └── postgresql-schema.sql
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── http.js
│   ├── scoring.js
│   ├── security.js
│   ├── server.js
│   └── store.js
└── test/
    ├── scoring.test.js
    ├── security.test.js
    └── store.test.js
```

## 3. 核心模块

### 3.1 `src/server.js`

负责：

- 静态资源服务
- 登录态处理
- REST API 路由分发
- 请求体解析、输入校验和统一错误返回
- 审计、权限校验、导出下载、健康检查与监控接口

### 3.2 `src/store.js`

负责：

- 初始化 SQLite 数据库
- 首次启动从 `data/store.json` 导入种子数据
- 将种子明文密码升级为哈希存储
- 管理评审记录、模板、审计日志和备份
- 批次、人员、评价体系管理
- 评分记录创建、保存、提交
- 统计结果、个人结果和分页列表查询
- 员工自评、主管复核、多评委评分汇总与最终结果同步

### 3.3 `src/scoring.js`

负责：

- 从评价体系中提取评分项
- 计算原始分、加权分、满分、得分率
- 计算关键项得分率
- 根据等级规则自动定级
- 汇总维度统计和批次统计

### 3.4 `src/security.js`

负责：

- 密码哈希与校验
- 种子账号密码升级

### 3.5 `src/http.js`

负责：

- 列表查询参数解析
- JSON 请求体解析
- HTTP 错误对象和分页辅助

## 4. 核心数据模型

### User

- `id`
- `username`
- `password`
- `name`
- `role`
- `personId`
- `ssoSubject`

### Person

- `id`
- `employeeNo`
- `name`
- `department`
- `position`

### EvaluationCycle

- `id`
- `name`
- `status`
- `createdAt`
- `framework`

### QualificationFramework

- `id`
- `name`
- `scoreOptions`
- `weightOptions`
- `levels`
- `dimensions`

### LevelDefinition

- `id`
- `name`
- `order`
- `minRate`
- `maxRate`
- `keyRule`

### ScoreItemDefinition

- `id`
- `title`
- `description`
- `weight`
- `isKeyItem`

### Evaluation

- `id`
- `cycleId`
- `personId`
- `status`
- `scores`
- `result`

### ReviewSubmission

- `id`
- `cycleId`
- `personId`
- `reviewerId`
- `reviewType`
- `status`
- `comments`
- `scores`
- `result`

### AuditLog

- `id`
- `actorUserId`
- `action`
- `entityType`
- `entityId`
- `details`
- `createdAt`

### FrameworkTemplate

- `id`
- `name`
- `description`
- `framework`

## 5. 关键业务规则

- 一个批次内一个人员只有一份最终评分记录
- 草稿批次允许修改评价体系，激活批次冻结评价体系
- 若评分记录不存在，首次进入评分页时自动创建草稿评价
- 所有统计按批次隔离

## 6. 后续演进建议

- 从 SQLite 继续迁移到 PostgreSQL，并补充正式迁移脚本和数据校验
- 将当前角色权限集扩展为更细粒度的资源权限和组织范围授权
- 对审批流、汇总策略、导入模板增加更强的可配置能力
- 将轻量 SSO 升级为可接入企业标准身份协议的实现
- 若切换 PostgreSQL，可将当前单容器部署扩展为应用容器 + 数据库容器
