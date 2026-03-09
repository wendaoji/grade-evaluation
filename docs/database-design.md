# 数据库表结构设计

本文档给出当前数据库实现与后续演进方向。当前项目已落地 SQLite 版本，后续可平移到 PostgreSQL 或 MySQL。

## 1. 设计目标

- 支持评价批次独立管理
- 支持评价体系版本快照
- 支持等级、维度、分类、评分项配置
- 支持单人评分记录与逐项得分明细
- 支持加权评分、关键项门槛和统计分析

## 2. 表清单

- `users`
- `people`
- `evaluation_cycles`
- `frameworks`
- `framework_levels`
- `framework_dimensions`
- `framework_categories`
- `framework_score_items`
- `evaluations`
- `evaluation_scores`

## 3. 详细表设计

### 3.1 `users`

用户表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `username` | `varchar(64)` | 登录名，唯一 |
| `password_hash` | `varchar(255)` | 密码哈希 |
| `name` | `varchar(128)` | 用户姓名 |
| `role` | `varchar(32)` | `admin` / `reviewer` |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

约束：

- `username` 唯一索引

### 3.2 `people`

被评价人员表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `employee_no` | `varchar(64)` | 工号，建议唯一 |
| `name` | `varchar(128)` | 姓名 |
| `department` | `varchar(128)` | 部门 |
| `position` | `varchar(128)` | 岗位 |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

### 3.3 `evaluation_cycles`

评价批次表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `name` | `varchar(128)` | 批次名称 |
| `status` | `varchar(32)` | `draft` / `active` / `closed` |
| `framework_id` | `uuid` | 绑定的体系快照 |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

约束：

- `framework_id` 外键关联 `frameworks.id`

### 3.4 `frameworks`

评价体系主表，表示某一版冻结后的评价体系快照。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `name` | `varchar(128)` | 体系名称 |
| `score_options_json` | `jsonb` | 评分档位，默认 `[0,1,3]` |
| `weight_options_json` | `jsonb` | 权重档位，默认 `[1,1.5,2]` |
| `created_by` | `uuid` | 创建人 |
| `created_at` | `timestamp` | 创建时间 |

说明：

- 一旦某个体系被批次绑定并激活，应视为不可变快照

### 3.5 `framework_levels`

等级定义表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `framework_id` | `uuid` | 所属体系 |
| `name` | `varchar(32)` | 等级名，如 `L1` |
| `display_order` | `int` | 排序 |
| `min_rate` | `numeric(6,4)` | 最小得分率 |
| `max_rate` | `numeric(6,4)` | 最大得分率 |
| `key_rule_enabled` | `boolean` | 是否启用关键项规则 |
| `min_key_rate` | `numeric(6,4)` | 关键项最低得分率 |
| `disallow_zero_key_score` | `boolean` | 是否禁止关键项 0 分 |

索引建议：

- `(framework_id, display_order)`

### 3.6 `framework_dimensions`

维度表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `framework_id` | `uuid` | 所属体系 |
| `name` | `varchar(128)` | 维度名 |
| `display_order` | `int` | 排序 |

### 3.7 `framework_categories`

分类表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `dimension_id` | `uuid` | 所属维度 |
| `name` | `varchar(128)` | 分类名 |
| `display_order` | `int` | 排序 |

### 3.8 `framework_score_items`

评分项表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `category_id` | `uuid` | 所属分类 |
| `title` | `varchar(255)` | 评分项标题 |
| `description` | `text` | 说明 |
| `weight` | `numeric(4,2)` | 权重 |
| `is_key_item` | `boolean` | 是否关键项 |
| `display_order` | `int` | 排序 |

约束建议：

- `weight` 仅允许当前系统支持的档位

### 3.9 `evaluations`

单个人员在单个批次下的一份评价记录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `cycle_id` | `uuid` | 所属批次 |
| `person_id` | `uuid` | 被评价人员 |
| `reviewer_id` | `uuid` | 当前评分人 |
| `status` | `varchar(32)` | `draft` / `submitted` |
| `raw_score` | `numeric(10,2)` | 原始分 |
| `weighted_score` | `numeric(10,2)` | 加权得分 |
| `weighted_max_score` | `numeric(10,2)` | 加权满分 |
| `score_rate` | `numeric(6,4)` | 综合得分率 |
| `key_score_rate` | `numeric(6,4)` | 关键项得分率 |
| `has_zero_key_score` | `boolean` | 关键项是否有 0 分 |
| `level_id` | `uuid` | 最终等级 |
| `submitted_at` | `timestamp` | 提交时间 |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

约束：

- `(cycle_id, person_id)` 唯一，确保单人最终评分

索引建议：

- `(cycle_id, status)`
- `(cycle_id, level_id)`

### 3.10 `evaluation_scores`

逐评分项打分明细。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `evaluation_id` | `uuid` | 所属评价记录 |
| `score_item_id` | `uuid` | 评分项 |
| `score_value` | `int` | 评分值，`0/1/3` |
| `weighted_score` | `numeric(10,2)` | 加权得分 |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

约束：

- `(evaluation_id, score_item_id)` 唯一

## 4. 关系说明

```text
frameworks 1 --- n framework_levels
frameworks 1 --- n framework_dimensions
framework_dimensions 1 --- n framework_categories
framework_categories 1 --- n framework_score_items

evaluation_cycles n --- 1 frameworks
evaluations n --- 1 evaluation_cycles
evaluations n --- 1 people
evaluations n --- 1 users(reviewer)
evaluations 1 --- n evaluation_scores
evaluation_scores n --- 1 framework_score_items
```

## 5. 关键查询场景

### 5.1 查询评分表

按批次拿到 `framework_id`，再查：

- 等级规则
- 维度
- 分类
- 评分项
- 当前人员的评分明细

### 5.2 计算个人结果

基于 `evaluation_scores` 聚合：

- `raw_score = sum(score_value)`
- `weighted_score = sum(weighted_score)`
- `weighted_max_score = sum(3 * weight)`
- `score_rate = weighted_score / weighted_max_score`

关键项规则：

- 仅统计 `is_key_item = true` 的评分项

### 5.3 批次统计

按 `cycle_id` 聚合：

- 等级人数分布
- 各维度平均得分率
- 个人结果列表

## 6. 当前实现说明

当前仓库中的数据库实现特点如下：

1. 运行时数据库默认文件为 `data/grade-evaluation.db`
2. 当数据库为空时，系统会自动从 `data/store.json` 导入默认种子数据
3. `src/store.js` 已切换为 SQLite 数据访问层
4. 评分算法仍统一复用 `src/scoring.js`

## 7. 后续迁移建议

若需要从 SQLite 继续迁移到 PostgreSQL/MySQL，建议按以下顺序推进：

1. 保持当前表结构语义不变
2. 将 `src/store.js` 中的 SQL 访问替换为新的数据库访问实现
3. 保留评分计算逻辑在服务层复用
4. 引入密码哈希、审计日志和导入导出能力
