# 接口说明

## 1. 认证接口

### `POST /api/auth/login`

登录系统。

请求体：

```json
{
  "username": "admin",
  "password": "admin123"
}
```

返回：

```json
{
  "user": {
    "id": "user-admin",
    "username": "admin",
    "name": "系统管理员",
    "role": "admin"
  }
}
```

### `POST /api/auth/logout`

退出登录。

### `GET /api/auth/me`

获取当前登录用户。

### `POST /api/auth/sso-login`

通过请求头 `x-sso-user` 或查询参数 `username` 登录已映射账号。

## 2. 应用总览接口

### `GET /api/app-state`

返回当前用户可见的基础数据，包括：

- 用户列表（仅管理员）
- 人员列表
- 批次列表
- 评价记录摘要
- 当前用户角色可见的结果与评审上下文

## 3. 批次接口

### `GET /api/cycles`

分页查询批次列表。

支持查询参数：

- `page`
- `pageSize`
- `keyword`
- `sortBy`：`createdAt / name / status`
- `sortOrder`：`asc / desc`

### `POST /api/cycles`

创建草稿批次。

请求体：

```json
{
  "name": "2026 下半年任职资格评价"
}
```

### `PATCH /api/cycles/:cycleId/status`

切换批次状态。

请求体：

```json
{
  "status": "active"
}
```

可选值：

- `draft`
- `active`
- `closed`

## 4. 评价体系接口

### `PUT /api/cycles/:cycleId/framework`

保存指定批次的评价体系，仅草稿批次允许调用。

请求体核心结构：

```json
{
  "name": "默认评价体系",
  "levels": [],
  "dimensions": []
}
```

等级对象关键字段：

- `name`
- `order`
- `minRate`
- `maxRate`
- `keyRule.enabled`
- `keyRule.minKeyRate`
- `keyRule.disallowZeroKeyScore`

评分项关键字段：

- `title`
- `description`
- `weight`
- `isKeyItem`

### `POST /api/cycles/:cycleId/framework/import`

将 JSON 格式的评价体系导入到指定草稿批次。

请求体支持：

- `framework`：直接传对象
- `content`：传 JSON 字符串

示例：

```json
{
  "content": "{\"name\":\"导入体系\",\"levels\":[],\"dimensions\":[]}"
}
```

### `GET /api/framework-templates`

获取可用规则模板。

### `POST /api/cycles/:cycleId/framework/apply-template`

将指定模板应用到草稿批次。

## 5. 人员接口

### `GET /api/people`

分页查询人员列表。

支持查询参数：

- `page`
- `pageSize`
- `keyword`
- `sortBy`：`employeeNo / name / department / position`
- `sortOrder`：`asc / desc`

### `POST /api/people`

新增人员。

请求体：

```json
{
  "employeeNo": "E003",
  "name": "王五",
  "department": "AI 创新部",
  "position": "技术专家"
}
```

### `PUT /api/people/:personId`

更新人员信息。

### `POST /api/import/people`

批量导入人员，支持两种方式：

- `rows`：直接传数组
- `content`：传 CSV 文本

示例：

```json
{
  "mode": "merge",
  "content": "employeeNo,name,department,position\nE003,王五,AI创新部,技术专家"
}
```

## 6. 评分接口

### `GET /api/evaluations/:cycleId/people/:personId/form`

获取某人在某批次下的评分表。

返回内容包括：

- 批次信息
- 人员信息
- 当前评分记录
- 评分表树形结构
- 当前计算结果

评分表中的每个评分项包含：

- `weight`
- `isKeyItem`
- `maxWeightedScore`
- `score`

### `PUT /api/evaluations/:cycleId/people/:personId/scores`

保存评分。

请求体：

```json
{
  "scores": {
    "item-platform-architecture": 3,
    "item-backend-api": 1
  }
}
```

### `POST /api/evaluations/:cycleId/people/:personId/submit`

提交评分结果。

## 7. 评审工作流接口

### `GET /api/reviews/:cycleId/people/:personId`

获取某人在某批次下的所有评审记录。

### `GET /api/reviews/:cycleId/people/:personId/form`

获取当前用户在指定 `reviewType` 下的评审表单。

查询参数：

- `reviewType=self|peer|supervisor`

### `PUT /api/reviews/:cycleId/people/:personId/scores`

保存评审得分。

请求体：

```json
{
  "reviewType": "peer",
  "scores": {
    "item-platform-architecture": 3
  },
  "comments": "表现稳定"
}
```

支持 `self / peer / supervisor`。

### `POST /api/reviews/:cycleId/people/:personId/submit`

提交评审记录。

### `PATCH /api/reviews/:reviewId/status`

主管或管理员审核评审记录，支持 `approved / rejected`。

## 8. 结果接口

### `GET /api/results/:cycleId/people/:personId`

获取个人评价结果。

返回中包含：

- `rawScore`
- `weightedScore`
- `weightedMaxScore`
- `scoreRate`
- `keyScoreRate`
- `levelId`
- `levelName`
- `dimensionSummaries`

### `GET /api/results/:cycleId/analytics`

获取批次统计结果。

返回中包含：

- `levelDistribution`
- `dimensionAverages`
- `departmentDistribution`
- `positionDistribution`
- `personalResults`

### `GET /api/results/trends`

获取多批次趋势分析结果。

### `GET /api/results/:cycleId/personal-results`

分页查询某批次的个人结果列表。

支持查询参数：

- `page`
- `pageSize`
- `keyword`
- `sortBy`：`scoreRate / personName / employeeNo / levelName / status`
- `sortOrder`：`asc / desc`

### `GET /api/results/:cycleId/export`

导出某批次结果。

查询参数：

- `format=csv`
- `format=json`

## 9. 审计与运维接口

### `GET /api/audit-logs`

分页获取审计日志。

支持查询参数：

- `page`
- `pageSize`
- `keyword`
- `sortBy`：`createdAt / action / entityType`
- `sortOrder`：`asc / desc`

### `GET /healthz`

健康检查。

### `GET /readyz`

就绪检查。

### `GET /metrics`

运行监控指标。

### `POST /api/admin/backup`

生成数据库备份。
