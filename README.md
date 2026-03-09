# 人员任职资格评价 APP

一个零依赖的可运行 MVP，覆盖以下能力：

- 管理员登录、批次管理、人员管理
- 评价体系配置：等级、维度、分类、评分项、权重、关键项门槛
- 评委按 `0 / 1 / 3` 对人员逐项评分
- 系统按加权得分率自动定级
- 批次统计：等级分布、维度平均得分率、个人结果列表
- SQLite 数据库存储，并支持首次从 JSON 种子数据自动导入
- 密码哈希存储、统一错误处理、列表分页筛选排序
- 批量导入人员与评价体系、结果导出、部门/岗位统计

## 启动

```bash
npm start
```

默认访问地址：`http://localhost:3000`

## 容器部署

### Docker

构建镜像：

```bash
docker build -t grade-evaluation .
```

启动容器：

```bash
docker run -d --name grade-evaluation \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  grade-evaluation
```

### Docker Compose

```bash
docker compose up -d --build
```

说明：

- 容器内服务监听 `3000`
- SQLite 数据库和种子文件通过挂载本地 `data/` 目录持久化
- 首次启动时若数据库为空，仍会自动从 `data/store.json` 导入默认数据

## 测试

```bash
npm test
```

## 默认账号

- 管理员：`admin / admin123`
- 评委：`reviewer / review123`

系统会在首次导入或启动时自动将明文种子密码升级为哈希存储。

## 阶段 2 接口增强

新增列表接口能力：

- `GET /api/people`
- `GET /api/cycles`
- `GET /api/results/:cycleId/personal-results`

新增业务增强接口能力：

- `POST /api/import/people`
- `POST /api/cycles/:cycleId/framework/import`
- `GET /api/results/:cycleId/export`

这些接口支持以下查询参数：

- `page`
- `pageSize`
- `keyword`
- `sortBy`
- `sortOrder`

## 数据说明

- 运行时数据库默认位于 `data/grade-evaluation.db`
- 首次启动且数据库为空时，会从 [data/store.json](/Users/wendaoji/workspace/wendaoji/gradeEvaluation/data/store.json) 自动导入种子数据
- 可通过环境变量 `GRADE_EVAL_DB_PATH` 和 `GRADE_EVAL_SEED_PATH` 指定数据库和种子文件位置
- 当前实现已切换到 SQLite，适合单机开发和 MVP 验证
- 若继续演进到生产环境，建议迁移到 PostgreSQL/MySQL，并补充更细粒度权限、批量导入、审计日志和多评委汇总机制
