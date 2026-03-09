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
│   ├── overview.md
│   ├── requirements.md
│   └── roadmap.md
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── scoring.js
│   ├── server.js
│   └── store.js
└── test/
    └── scoring.test.js
```

## 3. 核心模块

### 3.1 `src/server.js`

负责：

- 静态资源服务
- 登录态处理
- REST API 路由分发
- 请求体解析、输入校验和统一错误返回

### 3.2 `src/store.js`

负责：

- 初始化 SQLite 数据库
- 首次启动从 `data/store.json` 导入种子数据
- 将种子明文密码升级为哈希存储
- 管理评审记录、模板、审计日志和备份
- 批次、人员、评价体系管理
- 评分记录创建、保存、提交
- 统计结果、个人结果和分页列表查询

### 3.3 `src/scoring.js`

负责：

- 从评价体系中提取评分项
- 计算原始分、加权分、满分、得分率
- 计算关键项得分率
- 根据等级规则自动定级
- 汇总维度统计和批次统计

## 4. 核心数据模型

### User

- `id`
- `username`
- `password`
- `name`
- `role`

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

## 5. 关键业务规则

- 一个批次内一个人员只有一份最终评分记录
- 草稿批次允许修改评价体系，激活批次冻结评价体系
- 若评分记录不存在，首次进入评分页时自动创建草稿评价
- 所有统计按批次隔离

## 6. 后续演进建议

- 从 SQLite 继续迁移到 MySQL 或 PostgreSQL
- 增加员工自评、审批流、多评委汇总
- 增加批量导入导出
- 增加组织维度和时间趋势统计
- 接入企业单点登录与审计日志
- 若切换 PostgreSQL，可将当前单容器部署扩展为应用容器 + 数据库容器
