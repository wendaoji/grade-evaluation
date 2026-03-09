import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { buildEvaluationForm, calculateEvaluationResult, summarizeAnalytics } from "./scoring.js";
import { HttpError, paginate } from "./http.js";
import { hashPassword, isPasswordHashed, verifyPassword } from "./security.js";

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = process.env.GRADE_EVAL_DB_PATH ?? path.join(dataDir, "grade-evaluation.db");
const seedPath = process.env.GRADE_EVAL_SEED_PATH ?? path.join(dataDir, "store.json");

fs.mkdirSync(dataDir, { recursive: true });

const database = new DatabaseSync(dbPath);
database.exec("PRAGMA foreign_keys = ON");

initializeDatabase();

function runInTransaction(callback) {
  database.exec("BEGIN");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function initializeDatabase() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      person_id TEXT,
      sso_subject TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      employee_no TEXT NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      position TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS frameworks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      score_options_json TEXT NOT NULL,
      weight_options_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS framework_levels (
      id TEXT PRIMARY KEY,
      framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      min_rate REAL NOT NULL,
      max_rate REAL NOT NULL,
      key_rule_enabled INTEGER NOT NULL DEFAULT 0,
      min_key_rate REAL,
      disallow_zero_key_score INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS framework_dimensions (
      id TEXT PRIMARY KEY,
      framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS framework_categories (
      id TEXT PRIMARY KEY,
      dimension_id TEXT NOT NULL REFERENCES framework_dimensions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS framework_score_items (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES framework_categories(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      weight REAL NOT NULL,
      is_key_item INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_cycles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      framework_id TEXT NOT NULL REFERENCES frameworks(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      reviewer_id TEXT,
      status TEXT NOT NULL,
      raw_score REAL NOT NULL DEFAULT 0,
      weighted_score REAL NOT NULL DEFAULT 0,
      weighted_max_score REAL NOT NULL DEFAULT 0,
      score_rate REAL NOT NULL DEFAULT 0,
      key_score_rate REAL,
      has_zero_key_score INTEGER NOT NULL DEFAULT 0,
      level_id TEXT,
      level_name TEXT,
      submitted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(cycle_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS evaluation_scores (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
      score_item_id TEXT NOT NULL REFERENCES framework_score_items(id) ON DELETE CASCADE,
      score_value INTEGER NOT NULL,
      weighted_score REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(evaluation_id, score_item_id)
    );

    CREATE TABLE IF NOT EXISTS review_submissions (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      review_type TEXT NOT NULL,
      status TEXT NOT NULL,
      comments TEXT NOT NULL DEFAULT '',
      raw_score REAL NOT NULL DEFAULT 0,
      weighted_score REAL NOT NULL DEFAULT 0,
      weighted_max_score REAL NOT NULL DEFAULT 0,
      score_rate REAL NOT NULL DEFAULT 0,
      key_score_rate REAL,
      level_id TEXT,
      level_name TEXT,
      submitted_at TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(cycle_id, person_id, reviewer_id, review_type)
    );

    CREATE TABLE IF NOT EXISTS review_submission_scores (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES review_submissions(id) ON DELETE CASCADE,
      score_item_id TEXT NOT NULL REFERENCES framework_score_items(id) ON DELETE CASCADE,
      score_value REAL NOT NULL,
      weighted_score REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(submission_id, score_item_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS framework_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      framework_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn("users", "person_id", "TEXT");
  ensureColumn("users", "sso_subject", "TEXT");

  const userCount = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0 && fs.existsSync(seedPath)) {
    importSeedFromJson(seedPath);
  }

  upgradePlaintextPasswords();
  ensureWorkflowSeedUsers();
  ensureFrameworkTemplates();
}

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function parseDelimitedText(text) {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()));
  if (rows.length < 2) {
    throw new HttpError(400, "导入内容至少需要表头和一行数据");
  }
  const [header, ...body] = rows;
  return body
    .filter((row) => row.some(Boolean))
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])));
}

function normalizePeopleImport(input) {
  if (Array.isArray(input.rows)) {
    return input.rows;
  }
  if (typeof input.content === "string" && input.content.trim()) {
    return parseDelimitedText(input.content);
  }
  throw new HttpError(400, "人员导入内容不能为空");
}

function normalizeFrameworkImport(input) {
  if (input.framework && typeof input.framework === "object") {
    return input.framework;
  }
  if (typeof input.content === "string" && input.content.trim()) {
    try {
      return JSON.parse(input.content);
    } catch {
      throw new HttpError(400, "评价体系导入内容必须是合法 JSON");
    }
  }
  throw new HttpError(400, "评价体系导入内容不能为空");
}

function toCsv(rows, headers) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escapeCell(row[key])).join(","))].join("\n");
}

function compareValues(left, right, sortOrder) {
  if (left === right) {
    return 0;
  }
  const leftValue = typeof left === "string" ? left.localeCompare(String(right), "zh-CN") : left > right ? 1 : -1;
  return sortOrder === "asc" ? leftValue : -leftValue;
}

function sortAndPaginate(items, query, fieldMap) {
  const sortableField = fieldMap[query.sortBy] ? query.sortBy : Object.keys(fieldMap)[0];
  const sorted = [...items].sort((left, right) =>
    compareValues(fieldMap[sortableField](left), fieldMap[sortableField](right), query.sortOrder)
  );
  return paginate(sorted, query);
}

function upgradePlaintextPasswords() {
  const users = database.prepare("SELECT id, password FROM users").all();
  const updatePassword = database.prepare("UPDATE users SET password = ?, updated_at = ? WHERE id = ?");
  for (const user of users) {
    if (!isPasswordHashed(user.password)) {
      updatePassword.run(hashPassword(user.password), now(), user.id);
    }
  }
}

function ensureWorkflowSeedUsers() {
  const insertUser = database.prepare(
    `INSERT INTO users (id, username, password, name, role, person_id, sso_subject, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const users = database.prepare("SELECT username FROM users").all().map((row) => row.username);
  const userSet = new Set(users);
  const timestamp = now();

  if (!userSet.has("supervisor")) {
    insertUser.run(
      randomUUID(),
      "supervisor",
      hashPassword("super123"),
      "主管账号",
      "supervisor",
      null,
      "supervisor",
      timestamp,
      timestamp
    );
    userSet.add("supervisor");
  }

  if (!userSet.has("auditor")) {
    insertUser.run(
      randomUUID(),
      "auditor",
      hashPassword("audit123"),
      "审计账号",
      "auditor",
      null,
      "auditor",
      timestamp,
      timestamp
    );
    userSet.add("auditor");
  }

  const people = database.prepare("SELECT id, employee_no, name FROM people").all();
  for (const person of people) {
    const username = `employee_${person.employee_no}`;
    if (!userSet.has(username)) {
      insertUser.run(
        randomUUID(),
        username,
        hashPassword("employee123"),
        `${person.name}自评账号`,
        "employee",
        person.id,
        username,
        timestamp,
        timestamp
      );
      userSet.add(username);
    }
  }
}

function ensureFrameworkTemplates() {
  const templates = [
    {
      id: "template-score-only",
      name: "仅分数阈值",
      description: "所有等级仅按得分率区间判定，不启用关键项规则",
      transform: (framework) => ({
        ...framework,
        levels: framework.levels.map((level) => ({
          ...level,
          keyRule: { enabled: false, minKeyRate: null, disallowZeroKeyScore: false }
        }))
      })
    },
    {
      id: "template-strict-key",
      name: "严格关键项",
      description: "高等级启用更严格的关键项最低得分率和零分限制",
      transform: (framework) => ({
        ...framework,
        levels: framework.levels.map((level) => ({
          ...level,
          keyRule:
            Number(level.order) >= Math.max(4, framework.levels.length - 1)
              ? { enabled: true, minKeyRate: 0.8, disallowZeroKeyScore: true }
              : { enabled: false, minKeyRate: null, disallowZeroKeyScore: false }
        }))
      })
    },
    {
      id: "template-balanced",
      name: "平衡模板",
      description: "高等级保留适度关键项门槛，适合大多数场景",
      transform: (framework) => ({
        ...framework,
        levels: framework.levels.map((level) => ({
          ...level,
          keyRule:
            Number(level.order) >= Math.max(4, framework.levels.length - 1)
              ? { enabled: true, minKeyRate: 0.6, disallowZeroKeyScore: false }
              : { enabled: false, minKeyRate: null, disallowZeroKeyScore: false }
        }))
      })
    }
  ];

  const upsertTemplate = database.prepare(
    `INSERT OR REPLACE INTO framework_templates (id, name, description, framework_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const referenceFramework = getAllCycles()[0]?.framework;
  if (!referenceFramework) {
    return;
  }
  for (const template of templates) {
    upsertTemplate.run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.transform(clone(referenceFramework))),
      now()
    );
  }
}

function addAuditLog(action, entityType, entityId, details = {}, actorUserId = null) {
  database
    .prepare(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), actorUserId, action, entityType, entityId, JSON.stringify(details), now());
}

export function recordAuditLog(action, entityType, entityId, details = {}, actorUserId = null) {
  addAuditLog(action, entityType, entityId, details, actorUserId);
  return { ok: true };
}

function sanitizeFramework(framework, options = {}) {
  const regenerateIds = Boolean(options.regenerateIds);
  return {
    id: !regenerateIds && framework.id ? framework.id : randomUUID(),
    name: framework.name ?? "未命名评价体系",
    scoreOptions: [0, 1, 3],
    weightOptions: [1, 1.5, 2],
    levels: (framework.levels ?? [])
      .map((level, index) => ({
        id: !regenerateIds && level.id ? level.id : randomUUID(),
        name: level.name?.trim() || `L${index + 1}`,
        order: Number(level.order ?? index + 1),
        minRate: Number(level.minRate ?? 0),
        maxRate:
          level.maxRate === "" || level.maxRate === null || level.maxRate === undefined
            ? 1
            : Number(level.maxRate),
        keyRule: level.keyRule?.enabled
          ? {
              enabled: true,
              minKeyRate:
                level.keyRule.minKeyRate === "" ||
                level.keyRule.minKeyRate === null ||
                level.keyRule.minKeyRate === undefined
                  ? null
                  : Number(level.keyRule.minKeyRate),
              disallowZeroKeyScore: Boolean(level.keyRule.disallowZeroKeyScore)
            }
          : {
              enabled: false,
              minKeyRate: null,
              disallowZeroKeyScore: false
            }
      }))
      .sort((left, right) => left.order - right.order),
    dimensions: (framework.dimensions ?? []).map((dimension) => ({
      id: !regenerateIds && dimension.id ? dimension.id : randomUUID(),
      name: dimension.name?.trim() || "未命名维度",
      categories: (dimension.categories ?? []).map((category) => ({
        id: !regenerateIds && category.id ? category.id : randomUUID(),
        name: category.name?.trim() || "未命名分类",
        items: (category.items ?? []).map((item) => ({
          id: !regenerateIds && item.id ? item.id : randomUUID(),
          title: item.title?.trim() || "未命名评分项",
          description: item.description?.trim() || "",
          weight: [1, 1.5, 2].includes(Number(item.weight)) ? Number(item.weight) : 1,
          isKeyItem: Boolean(item.isKeyItem)
        }))
      }))
    }))
  };
}

function persistFramework(connection, framework, options = {}) {
  const timestamp = options.createdAt ?? now();
  connection
    .prepare(
      `INSERT INTO frameworks (id, name, score_options_json, weight_options_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      framework.id,
      framework.name,
      JSON.stringify(framework.scoreOptions),
      JSON.stringify(framework.weightOptions),
      timestamp
    );

  const insertLevel = connection.prepare(
    `INSERT INTO framework_levels
      (id, framework_id, name, display_order, min_rate, max_rate, key_rule_enabled, min_key_rate, disallow_zero_key_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDimension = connection.prepare(
    `INSERT INTO framework_dimensions (id, framework_id, name, display_order)
     VALUES (?, ?, ?, ?)`
  );
  const insertCategory = connection.prepare(
    `INSERT INTO framework_categories (id, dimension_id, name, display_order)
     VALUES (?, ?, ?, ?)`
  );
  const insertItem = connection.prepare(
    `INSERT INTO framework_score_items (id, category_id, title, description, weight, is_key_item, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  framework.levels.forEach((level, index) => {
    insertLevel.run(
      level.id,
      framework.id,
      level.name,
      Number(level.order ?? index + 1),
      Number(level.minRate ?? 0),
      Number(level.maxRate ?? 1),
      level.keyRule?.enabled ? 1 : 0,
      level.keyRule?.minKeyRate ?? null,
      level.keyRule?.disallowZeroKeyScore ? 1 : 0
    );
  });

  framework.dimensions.forEach((dimension, dimensionIndex) => {
    insertDimension.run(dimension.id, framework.id, dimension.name, dimensionIndex + 1);
    dimension.categories.forEach((category, categoryIndex) => {
      insertCategory.run(category.id, dimension.id, category.name, categoryIndex + 1);
      category.items.forEach((item, itemIndex) => {
        insertItem.run(
          item.id,
          category.id,
          item.title,
          item.description ?? "",
          Number(item.weight ?? 1),
          item.isKeyItem ? 1 : 0,
          itemIndex + 1
        );
      });
    });
  });
}

function deleteFramework(connection, frameworkId) {
  connection.prepare("DELETE FROM frameworks WHERE id = ?").run(frameworkId);
}

function hydrateFramework(frameworkId) {
  const frameworkRow = database.prepare("SELECT * FROM frameworks WHERE id = ?").get(frameworkId);
  if (!frameworkRow) {
    return null;
  }

  const levels = database
    .prepare(
      `SELECT * FROM framework_levels
       WHERE framework_id = ?
       ORDER BY display_order ASC`
    )
    .all(frameworkId)
    .map((level) => ({
      id: level.id,
      name: level.name,
      order: level.display_order,
      minRate: Number(level.min_rate),
      maxRate: Number(level.max_rate),
      keyRule: {
        enabled: Boolean(level.key_rule_enabled),
        minKeyRate: level.min_key_rate === null ? null : Number(level.min_key_rate),
        disallowZeroKeyScore: Boolean(level.disallow_zero_key_score)
      }
    }));

  const dimensions = database
    .prepare(
      `SELECT * FROM framework_dimensions
       WHERE framework_id = ?
       ORDER BY display_order ASC`
    )
    .all(frameworkId)
    .map((dimension) => {
      const categories = database
        .prepare(
          `SELECT * FROM framework_categories
           WHERE dimension_id = ?
           ORDER BY display_order ASC`
        )
        .all(dimension.id)
        .map((category) => ({
          id: category.id,
          name: category.name,
          items: database
            .prepare(
              `SELECT * FROM framework_score_items
               WHERE category_id = ?
               ORDER BY display_order ASC`
            )
            .all(category.id)
            .map((item) => ({
              id: item.id,
              title: item.title,
              description: item.description,
              weight: Number(item.weight),
              isKeyItem: Boolean(item.is_key_item)
            }))
        }));

      return {
        id: dimension.id,
        name: dimension.name,
        categories
      };
    });

  return {
    id: frameworkRow.id,
    name: frameworkRow.name,
    scoreOptions: JSON.parse(frameworkRow.score_options_json),
    weightOptions: JSON.parse(frameworkRow.weight_options_json),
    levels,
    dimensions
  };
}

function getCycleRow(cycleId) {
  return database.prepare("SELECT * FROM evaluation_cycles WHERE id = ?").get(cycleId);
}

function getCycle(cycleId) {
  const row = getCycleRow(cycleId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    framework: hydrateFramework(row.framework_id)
  };
}

function getAllCycles() {
  return database
    .prepare("SELECT * FROM evaluation_cycles ORDER BY created_at ASC")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.created_at,
      framework: hydrateFramework(row.framework_id)
    }));
}

function getPeople() {
  return database.prepare("SELECT * FROM people ORDER BY employee_no ASC, name ASC").all().map((row) => ({
    id: row.id,
    employeeNo: row.employee_no,
    name: row.name,
    department: row.department,
    position: row.position
  }));
}

function getUsers() {
  return database.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
}

function getEvaluationRow(cycleId, personId) {
  return database
    .prepare("SELECT * FROM evaluations WHERE cycle_id = ? AND person_id = ?")
    .get(cycleId, personId);
}

function getEvaluationScoresMap(evaluationId) {
  return Object.fromEntries(
    database
      .prepare("SELECT score_item_id, score_value FROM evaluation_scores WHERE evaluation_id = ?")
      .all(evaluationId)
      .map((row) => [row.score_item_id, Number(row.score_value)])
  );
}

function getReviewSubmissionRow(cycleId, personId, reviewerId, reviewType) {
  return database
    .prepare(
      `SELECT * FROM review_submissions
       WHERE cycle_id = ? AND person_id = ? AND reviewer_id = ? AND review_type = ?`
    )
    .get(cycleId, personId, reviewerId, reviewType);
}

function getReviewSubmissionScoresMap(submissionId) {
  return Object.fromEntries(
    database
      .prepare("SELECT score_item_id, score_value FROM review_submission_scores WHERE submission_id = ?")
      .all(submissionId)
      .map((row) => [row.score_item_id, Number(row.score_value)])
  );
}

function getUserById(userId) {
  return database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function enrichReviewSubmission(cycle, people, submissionRow) {
  const scores = getReviewSubmissionScoresMap(submissionRow.id);
  const reviewer = getUserById(submissionRow.reviewer_id);
  return {
    id: submissionRow.id,
    cycleId: submissionRow.cycle_id,
    personId: submissionRow.person_id,
    reviewerId: submissionRow.reviewer_id,
    reviewType: submissionRow.review_type,
    status: submissionRow.status,
    comments: submissionRow.comments,
    reviewer: reviewer
      ? {
          id: reviewer.id,
          username: reviewer.username,
          name: reviewer.name,
          role: reviewer.role,
          personId: reviewer.person_id ?? null
        }
      : null,
    person: people.find((person) => person.id === submissionRow.person_id) ?? null,
    form: buildEvaluationForm(cycle.framework, scores),
    result: buildStoredResult(calculateEvaluationResult(cycle.framework, scores))
  };
}

function syncAggregateEvaluation(cycleId, personId) {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    return null;
  }
  const submissionRows = database
    .prepare(
      `SELECT * FROM review_submissions
       WHERE cycle_id = ? AND person_id = ? AND status IN ('submitted', 'approved')`
    )
    .all(cycleId, personId);

  const aggregateScores = {};
  if (submissionRows.length > 0) {
    const allItemIds = cycle.framework.dimensions
      .flatMap((dimension) => dimension.categories)
      .flatMap((category) => category.items)
      .map((item) => item.id);

    for (const itemId of allItemIds) {
      let total = 0;
      let count = 0;
      for (const submission of submissionRows) {
        const submissionScores = getReviewSubmissionScoresMap(submission.id);
        if (submissionScores[itemId] !== undefined) {
          total += Number(submissionScores[itemId]);
          count += 1;
        }
      }
      aggregateScores[itemId] = count ? total / count : 0;
    }
  }

  const result = calculateEvaluationResult(cycle.framework, aggregateScores);
  const existing = getEvaluationRow(cycleId, personId);
  const timestamp = now();
  if (!existing) {
    database
      .prepare(
        `INSERT INTO evaluations
          (id, cycle_id, person_id, reviewer_id, status, raw_score, weighted_score, weighted_max_score, score_rate, key_score_rate, has_zero_key_score, level_id, level_name, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        cycleId,
        personId,
        null,
        submissionRows.length ? "aggregated" : "draft",
        result.rawScore,
        result.weightedScore,
        result.weightedMaxScore,
        result.scoreRate,
        result.keyScoreRate,
        result.hasZeroKeyScore ? 1 : 0,
        result.levelId,
        result.levelName,
        submissionRows.length ? timestamp : null,
        timestamp,
        timestamp
      );
  } else {
    database
      .prepare(
        `UPDATE evaluations
         SET reviewer_id = NULL,
             status = ?,
             raw_score = ?,
             weighted_score = ?,
             weighted_max_score = ?,
             score_rate = ?,
             key_score_rate = ?,
             has_zero_key_score = ?,
             level_id = ?,
             level_name = ?,
             submitted_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        submissionRows.length ? "aggregated" : "draft",
        result.rawScore,
        result.weightedScore,
        result.weightedMaxScore,
        result.scoreRate,
        result.keyScoreRate,
        result.hasZeroKeyScore ? 1 : 0,
        result.levelId,
        result.levelName,
        submissionRows.length ? timestamp : null,
        timestamp,
        existing.id
      );
  }
  return result;
}

function buildStoredResult(result) {
  return {
    rawScore: Number(result.rawScore ?? 0),
    weightedScore: Number(result.weightedScore ?? 0),
    weightedMaxScore: Number(result.weightedMaxScore ?? 0),
    scoreRate: Number(result.scoreRate ?? 0),
    keyScoreRate: result.keyScoreRate === null ? null : Number(result.keyScoreRate ?? 0),
    hasZeroKeyScore: Boolean(result.hasZeroKeyScore),
    levelId: result.levelId ?? null,
    levelName: result.levelName ?? "未定级",
    dimensionSummaries: result.dimensionSummaries ?? []
  };
}

function enrichEvaluation(cycle, people, evaluationRow) {
  const scores = getEvaluationScoresMap(evaluationRow.id);
  const result = buildStoredResult(calculateEvaluationResult(cycle.framework, scores));
  return {
    id: evaluationRow.id,
    cycleId: evaluationRow.cycle_id,
    personId: evaluationRow.person_id,
    status: evaluationRow.status,
    scores,
    person: people.find((person) => person.id === evaluationRow.person_id) ?? null,
    form: buildEvaluationForm(cycle.framework, scores),
    result
  };
}

function ensureCycleEditable(cycleRow) {
  if (!cycleRow) {
    throw new HttpError(404, "评价批次不存在");
  }
  if (cycleRow.status !== "draft") {
    throw new HttpError(409, "仅草稿批次允许修改评价体系");
  }
}

function importSeedFromJson(seedFile) {
  const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  runInTransaction(() => {
    const insertUser = database.prepare(
      `INSERT INTO users (id, username, password, name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertPerson = database.prepare(
      `INSERT INTO people (id, employee_no, name, department, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCycle = database.prepare(
      `INSERT INTO evaluation_cycles (id, name, status, framework_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertEvaluation = database.prepare(
      `INSERT INTO evaluations
        (id, cycle_id, person_id, reviewer_id, status, raw_score, weighted_score, weighted_max_score, score_rate, key_score_rate, has_zero_key_score, level_id, level_name, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertEvaluationScore = database.prepare(
      `INSERT INTO evaluation_scores
        (id, evaluation_id, score_item_id, score_value, weighted_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (const user of seed.users ?? []) {
      const createdAt = now();
      insertUser.run(
        user.id ?? randomUUID(),
        user.username,
        hashPassword(user.password),
        user.name,
        user.role,
        createdAt,
        createdAt
      );
    }

    for (const person of seed.people ?? []) {
      const createdAt = now();
      insertPerson.run(
        person.id ?? randomUUID(),
        person.employeeNo ?? "",
        person.name ?? "未命名人员",
        person.department ?? "",
        person.position ?? "",
        createdAt,
        createdAt
      );
    }

    for (const cycle of seed.cycles ?? []) {
      const framework = sanitizeFramework(cycle.framework ?? {}, { regenerateIds: false });
      persistFramework(database, framework, { createdAt: cycle.createdAt ?? now() });
      insertCycle.run(
        cycle.id ?? randomUUID(),
        cycle.name ?? "未命名批次",
        cycle.status ?? "draft",
        framework.id,
        cycle.createdAt ?? now(),
        cycle.createdAt ?? now()
      );
    }

    for (const evaluation of seed.evaluations ?? []) {
      const cycle = getCycle(evaluation.cycleId);
      if (!cycle) {
        continue;
      }
      const scores = Object.fromEntries(
        Object.entries(evaluation.scores ?? {}).map(([itemId, score]) => [itemId, Number(score)])
      );
      const result = buildStoredResult(
        evaluation.result ?? calculateEvaluationResult(cycle.framework, scores)
      );
      const createdAt = now();
      insertEvaluation.run(
        evaluation.id ?? randomUUID(),
        evaluation.cycleId,
        evaluation.personId,
        evaluation.reviewerId ?? null,
        evaluation.status ?? "draft",
        result.rawScore,
        result.weightedScore,
        result.weightedMaxScore,
        result.scoreRate,
        result.keyScoreRate,
        result.hasZeroKeyScore ? 1 : 0,
        result.levelId,
        result.levelName,
        evaluation.status === "submitted" ? createdAt : null,
        createdAt,
        createdAt
      );

      for (const [itemId, score] of Object.entries(scores)) {
        const item = cycle.framework.dimensions
          .flatMap((dimension) => dimension.categories)
          .flatMap((category) => category.items)
          .find((entry) => entry.id === itemId);
        insertEvaluationScore.run(
          randomUUID(),
          evaluation.id,
          itemId,
          Number(score),
          Number(score) * Number(item?.weight ?? 1),
          createdAt,
          createdAt
        );
      }
    }
  });
}

function persistEvaluationResult(connection, evaluationId, result, status) {
  const normalized = buildStoredResult(result);
  connection
    .prepare(
      `UPDATE evaluations
       SET status = ?,
           raw_score = ?,
           weighted_score = ?,
           weighted_max_score = ?,
           score_rate = ?,
           key_score_rate = ?,
           has_zero_key_score = ?,
           level_id = ?,
           level_name = ?,
           submitted_at = CASE WHEN ? = 'submitted' THEN COALESCE(submitted_at, ?) ELSE NULL END,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      normalized.rawScore,
      normalized.weightedScore,
      normalized.weightedMaxScore,
      normalized.scoreRate,
      normalized.keyScoreRate,
      normalized.hasZeroKeyScore ? 1 : 0,
      normalized.levelId,
      normalized.levelName,
      status,
      now(),
      now(),
      evaluationId
    );
}

export function getPublicAppState(role, userId = null) {
  const cycles = getAllCycles();
  const currentUser = userId ? getUserById(userId) : null;
  const people =
    role === "employee" && currentUser?.person_id
      ? getPeople().filter((person) => person.id === currentUser.person_id)
      : getPeople();
  return {
    users:
      role === "admin"
        ? getUsers().map(({ password, created_at, updated_at, ...user }) => user)
        : undefined,
    people,
    cycles,
    evaluations: database
      .prepare("SELECT id, cycle_id, person_id, status, level_name, score_rate FROM evaluations")
      .all()
      .map((row) => ({
        id: row.id,
        cycleId: row.cycle_id,
        personId: row.person_id,
        status: row.status,
        levelName: row.level_name,
        scoreRate: row.score_rate
      }))
  };
}

export function authenticate(username, password) {
  const user = database.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !verifyPassword(password, user.password)) {
    return null;
  }
  const { password: _password, created_at, updated_at, ...safeUser } = user;
  return safeUser;
}

export function authenticateSSO(subject) {
  const user = database
    .prepare("SELECT * FROM users WHERE username = ? OR sso_subject = ?")
    .get(subject, subject);
  if (!user) {
    return null;
  }
  const { password: _password, created_at, updated_at, ...safeUser } = user;
  return safeUser;
}

export function createCycle(input) {
  if (!input.name?.trim()) {
    throw new HttpError(400, "批次名称不能为空");
  }
  const template = getAllCycles().at(-1)?.framework;
  const framework = sanitizeFramework(
    template
      ? clone(template)
      : {
          name: "默认评价体系",
          levels: [],
          dimensions: []
        },
    { regenerateIds: true }
  );
  const cycleId = randomUUID();
  const createdAt = now();
  runInTransaction(() => {
    persistFramework(database, framework, { createdAt });
    database
      .prepare(
        `INSERT INTO evaluation_cycles (id, name, status, framework_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        cycleId,
        input.name?.trim() || `评价批次 ${getAllCycles().length + 1}`,
        "draft",
        framework.id,
        createdAt,
        createdAt
      );
  });
  return getCycle(cycleId);
}

export function updateCycleStatus(cycleId, status) {
  const cycleRow = getCycleRow(cycleId);
  if (!cycleRow) {
    throw new HttpError(404, "评价批次不存在");
  }
  if (!["draft", "active", "closed"].includes(status)) {
    throw new HttpError(400, "批次状态不合法");
  }
  database
    .prepare("UPDATE evaluation_cycles SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, now(), cycleId);
  return getCycle(cycleId);
}

export function updateFramework(cycleId, frameworkInput) {
  const cycleRow = getCycleRow(cycleId);
  ensureCycleEditable(cycleRow);
  const framework = sanitizeFramework(frameworkInput, { regenerateIds: true });

  runInTransaction(() => {
    database.prepare("DELETE FROM evaluation_scores WHERE evaluation_id IN (SELECT id FROM evaluations WHERE cycle_id = ?)").run(cycleId);
    database.prepare("DELETE FROM evaluations WHERE cycle_id = ?").run(cycleId);
    persistFramework(database, framework);
    database
      .prepare("UPDATE evaluation_cycles SET framework_id = ?, updated_at = ? WHERE id = ?")
      .run(framework.id, now(), cycleId);
    deleteFramework(database, cycleRow.framework_id);
  });
  return getCycle(cycleId).framework;
}

export function createPerson(input) {
  if (!input.name?.trim()) {
    throw new HttpError(400, "人员姓名不能为空");
  }
  const person = {
    id: randomUUID(),
    employeeNo: input.employeeNo?.trim() || "",
    name: input.name?.trim() || "未命名人员",
    department: input.department?.trim() || "",
    position: input.position?.trim() || ""
  };
  const createdAt = now();
  database
    .prepare(
      `INSERT INTO people (id, employee_no, name, department, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      person.id,
      person.employeeNo,
      person.name,
      person.department,
      person.position,
      createdAt,
      createdAt
    );
  ensureWorkflowSeedUsers();
  return person;
}

export function updatePerson(personId, input) {
  const existing = database.prepare("SELECT id FROM people WHERE id = ?").get(personId);
  if (!existing) {
    throw new HttpError(404, "人员不存在");
  }
  if (!input.name?.trim()) {
    throw new HttpError(400, "人员姓名不能为空");
  }
  const person = {
    id: personId,
    employeeNo: input.employeeNo?.trim() || "",
    name: input.name?.trim() || "未命名人员",
    department: input.department?.trim() || "",
    position: input.position?.trim() || ""
  };
  database
    .prepare(
      `UPDATE people
       SET employee_no = ?, name = ?, department = ?, position = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(person.employeeNo, person.name, person.department, person.position, now(), personId);
  return person;
}

export function getEvaluationForm(cycleId, personId) {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  const people = getPeople();
  const person = people.find((item) => item.id === personId);
  if (!person) {
    throw new HttpError(404, "人员不存在");
  }

  let evaluationRow = getEvaluationRow(cycleId, personId);
  if (!evaluationRow) {
    const createdAt = now();
    const evaluationId = randomUUID();
    database
      .prepare(
        `INSERT INTO evaluations
          (id, cycle_id, person_id, reviewer_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(evaluationId, cycleId, personId, null, "draft", createdAt, createdAt);
    evaluationRow = getEvaluationRow(cycleId, personId);
  }

  return {
    cycle,
    person,
    evaluation: enrichEvaluation(cycle, people, evaluationRow)
  };
}

export function saveEvaluationScores(cycleId, personId, scores) {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  const people = getPeople();
  const person = people.find((item) => item.id === personId);
  if (!person) {
    throw new HttpError(404, "人员不存在");
  }

  let evaluationRow = getEvaluationRow(cycleId, personId);
  if (!evaluationRow) {
    const createdAt = now();
    const evaluationId = randomUUID();
    database
      .prepare(
        `INSERT INTO evaluations
          (id, cycle_id, person_id, reviewer_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(evaluationId, cycleId, personId, null, "draft", createdAt, createdAt);
    evaluationRow = getEvaluationRow(cycleId, personId);
  }

  const normalizedScores = Object.fromEntries(
    Object.entries(scores ?? {}).map(([itemId, score]) => [itemId, Number(score)])
  );
  for (const value of Object.values(normalizedScores)) {
    if (![0, 1, 3].includes(value)) {
      throw new HttpError(400, "评分值仅允许 0、1、3");
    }
  }
  const itemsById = new Map(
    cycle.framework.dimensions
      .flatMap((dimension) => dimension.categories)
      .flatMap((category) => category.items)
      .map((item) => [item.id, item])
  );
  const result = calculateEvaluationResult(cycle.framework, normalizedScores);

  runInTransaction(() => {
    database.prepare("DELETE FROM evaluation_scores WHERE evaluation_id = ?").run(evaluationRow.id);
    const insertScore = database.prepare(
      `INSERT INTO evaluation_scores
        (id, evaluation_id, score_item_id, score_value, weighted_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const timestamp = now();
    for (const [itemId, score] of Object.entries(normalizedScores)) {
      const item = itemsById.get(itemId);
      if (!item) {
        continue;
      }
      insertScore.run(
        randomUUID(),
        evaluationRow.id,
        itemId,
        Number(score),
        Number(score) * Number(item.weight ?? 1),
        timestamp,
        timestamp
      );
    }
    persistEvaluationResult(database, evaluationRow.id, result, "draft");
  });
  return enrichEvaluation(cycle, people, getEvaluationRow(cycleId, personId));
}

export function submitEvaluation(cycleId, personId) {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  const people = getPeople();
  const evaluationRow = getEvaluationRow(cycleId, personId);
  if (!evaluationRow) {
    throw new HttpError(404, "尚未开始评分");
  }
  const scores = getEvaluationScoresMap(evaluationRow.id);
  const result = calculateEvaluationResult(cycle.framework, scores);
  persistEvaluationResult(database, evaluationRow.id, result, "submitted");
  return enrichEvaluation(cycle, people, getEvaluationRow(cycleId, personId));
}

export function getCycleAnalytics(cycleId) {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  const people = getPeople();
  const evaluations = database
    .prepare("SELECT * FROM evaluations WHERE cycle_id = ?")
    .all(cycleId)
    .map((row) => enrichEvaluation(cycle, people, row));
  return summarizeAnalytics(cycle, people, evaluations);
}

export function getPersonResult(cycleId, personId) {
  const cycle = getCycle(cycleId);
  const people = getPeople();
  const person = people.find((item) => item.id === personId);
  const evaluation = getEvaluationRow(cycleId, personId);
  if (!cycle || !person || !evaluation) {
    throw new HttpError(404, "结果不存在");
  }
  return {
    cycle,
    person,
    evaluation: enrichEvaluation(cycle, people, evaluation)
  };
}

export function getPeopleList(query) {
  const items = getPeople().filter((person) => {
    if (!query.keyword) {
      return true;
    }
    const haystack = `${person.employeeNo} ${person.name} ${person.department} ${person.position}`.toLowerCase();
    return haystack.includes(query.keyword.toLowerCase());
  });

  return sortAndPaginate(items, query, {
    employeeNo: (item) => item.employeeNo,
    name: (item) => item.name,
    department: (item) => item.department,
    position: (item) => item.position
  });
}

export function getCyclesList(query) {
  const items = getAllCycles().filter((cycle) => {
    if (!query.keyword) {
      return true;
    }
    return cycle.name.toLowerCase().includes(query.keyword.toLowerCase());
  });

  return sortAndPaginate(items, query, {
    createdAt: (item) => item.createdAt,
    name: (item) => item.name,
    status: (item) => item.status
  });
}

export function getCyclePersonalResults(cycleId, query) {
  const analytics = getCycleAnalytics(cycleId);
  const items = analytics.personalResults.filter((item) => {
    if (!query.keyword) {
      return true;
    }
    const haystack = `${item.personName} ${item.employeeNo} ${item.department} ${item.position} ${item.levelName}`.toLowerCase();
    return haystack.includes(query.keyword.toLowerCase());
  });

  return sortAndPaginate(items, query, {
    scoreRate: (item) => item.scoreRate,
    personName: (item) => item.personName,
    employeeNo: (item) => item.employeeNo,
    levelName: (item) => item.levelName,
    status: (item) => item.status
  });
}

export function importPeopleBatch(input) {
  const rows = normalizePeopleImport(input);
  const mode = input.mode === "replace" ? "replace" : "merge";

  return runInTransaction(() => {
    if (mode === "replace") {
      database.prepare("DELETE FROM evaluation_scores").run();
      database.prepare("DELETE FROM evaluations").run();
      database.prepare("DELETE FROM people").run();
    }

    const existingEmployeeNos = new Set(
      database.prepare("SELECT employee_no FROM people").all().map((row) => row.employee_no)
    );
    const insertPerson = database.prepare(
      `INSERT INTO people (id, employee_no, name, department, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const updatePersonByEmployeeNo = database.prepare(
      `UPDATE people
       SET name = ?, department = ?, position = ?, updated_at = ?
       WHERE employee_no = ?`
    );

    let created = 0;
    let updated = 0;
    const timestamp = now();

    for (const row of rows) {
      const employeeNo = String(row.employeeNo ?? row.employee_no ?? "").trim();
      const name = String(row.name ?? "").trim();
      const department = String(row.department ?? "").trim();
      const position = String(row.position ?? "").trim();

      if (!employeeNo || !name) {
        throw new HttpError(400, "人员导入要求每行包含 employeeNo 和 name");
      }

      if (existingEmployeeNos.has(employeeNo)) {
        updatePersonByEmployeeNo.run(name, department, position, timestamp, employeeNo);
        updated += 1;
      } else {
        insertPerson.run(randomUUID(), employeeNo, name, department, position, timestamp, timestamp);
        existingEmployeeNos.add(employeeNo);
        created += 1;
      }
    }

    ensureWorkflowSeedUsers();
    return { mode, total: rows.length, created, updated };
  });
}

export function importFrameworkToCycle(cycleId, input) {
  const cycleRow = getCycleRow(cycleId);
  ensureCycleEditable(cycleRow);
  const framework = sanitizeFramework(normalizeFrameworkImport(input), { regenerateIds: true });

  runInTransaction(() => {
    database
      .prepare("DELETE FROM evaluation_scores WHERE evaluation_id IN (SELECT id FROM evaluations WHERE cycle_id = ?)")
      .run(cycleId);
    database.prepare("DELETE FROM evaluations WHERE cycle_id = ?").run(cycleId);
    persistFramework(database, framework);
    database
      .prepare("UPDATE evaluation_cycles SET framework_id = ?, updated_at = ? WHERE id = ?")
      .run(framework.id, now(), cycleId);
    deleteFramework(database, cycleRow.framework_id);
  });

  return getCycle(cycleId).framework;
}

export function exportCycleResults(cycleId, format = "csv") {
  const analytics = getCycleAnalytics(cycleId);
  const rows = analytics.personalResults.map((item) => ({
    employeeNo: item.employeeNo,
    personName: item.personName,
    department: item.department,
    position: item.position,
    levelName: item.levelName,
    scoreRate: item.scoreRate,
    keyScoreRate: item.keyScoreRate ?? "",
    status: item.status
  }));

  if (format === "json") {
    return {
      contentType: "application/json; charset=utf-8",
      filename: `${cycleId}-results.json`,
      body: JSON.stringify(rows, null, 2)
    };
  }

  return {
    contentType: "text/csv; charset=utf-8",
    filename: `${cycleId}-results.csv`,
    body: toCsv(rows, [
      "employeeNo",
      "personName",
      "department",
      "position",
      "levelName",
      "scoreRate",
      "keyScoreRate",
      "status"
    ])
  };
}

export function getTrendAnalytics() {
  const cycles = getAllCycles();
  return {
    cycles: cycles.map((cycle) => {
      const analytics = getCycleAnalytics(cycle.id);
      const averageScoreRate = analytics.personalResults.length
        ? Number(
            (
              analytics.personalResults.reduce((sum, item) => sum + Number(item.scoreRate || 0), 0) /
              analytics.personalResults.length
            ).toFixed(4)
          )
        : 0;
      return {
        cycleId: cycle.id,
        cycleName: cycle.name,
        createdAt: cycle.createdAt,
        averageScoreRate,
        levelDistribution: analytics.levelDistribution
      };
    })
  };
}

export function getFrameworkTemplates() {
  return database
    .prepare("SELECT * FROM framework_templates ORDER BY created_at ASC")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      framework: JSON.parse(row.framework_json)
    }));
}

export function applyFrameworkTemplate(cycleId, templateId) {
  const template = database.prepare("SELECT * FROM framework_templates WHERE id = ?").get(templateId);
  if (!template) {
    throw new HttpError(404, "模板不存在");
  }
  return importFrameworkToCycle(cycleId, { framework: JSON.parse(template.framework_json) });
}

export function getAuditLogs(query) {
  const logs = database
    .prepare("SELECT * FROM audit_logs ORDER BY created_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: JSON.parse(row.details_json),
      createdAt: row.created_at
    }));
  const filtered = logs.filter((item) => {
    if (!query.keyword) {
      return true;
    }
    return `${item.action} ${item.entityType} ${item.entityId}`.toLowerCase().includes(query.keyword.toLowerCase());
  });
  return sortAndPaginate(filtered, query, {
    createdAt: (item) => item.createdAt,
    action: (item) => item.action,
    entityType: (item) => item.entityType
  });
}

export function getMonitoringSnapshot() {
  return {
    users: database.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    people: database.prepare("SELECT COUNT(*) AS count FROM people").get().count,
    cycles: database.prepare("SELECT COUNT(*) AS count FROM evaluation_cycles").get().count,
    evaluations: database.prepare("SELECT COUNT(*) AS count FROM evaluations").get().count,
    reviewSubmissions: database.prepare("SELECT COUNT(*) AS count FROM review_submissions").get().count,
    auditLogs: database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count,
    dbPath
  };
}

export function backupDatabase(backupDir = path.join(dataDir, "backups")) {
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `grade-evaluation-${now().replace(/[:.]/g, "-")}.db`;
  const targetPath = path.join(backupDir, filename);
  fs.copyFileSync(dbPath, targetPath);
  return { targetPath, filename };
}

export function getReviewSubmissions(cycleId, personId) {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  const people = getPeople();
  return database
    .prepare(
      `SELECT * FROM review_submissions
       WHERE cycle_id = ? AND person_id = ?
       ORDER BY created_at ASC`
    )
    .all(cycleId, personId)
    .map((row) => enrichReviewSubmission(cycle, people, row));
}

export function getReviewForm(cycleId, personId, reviewerId, reviewType = "peer") {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  const people = getPeople();
  const person = people.find((item) => item.id === personId);
  if (!person) {
    throw new HttpError(404, "人员不存在");
  }
  let submission = getReviewSubmissionRow(cycleId, personId, reviewerId, reviewType);
  if (!submission) {
    const createdAt = now();
    database
      .prepare(
        `INSERT INTO review_submissions
          (id, cycle_id, person_id, reviewer_id, review_type, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), cycleId, personId, reviewerId, reviewType, "draft", createdAt, createdAt);
    submission = getReviewSubmissionRow(cycleId, personId, reviewerId, reviewType);
  }
  return {
    cycle,
    person,
    submission: enrichReviewSubmission(cycle, people, submission)
  };
}

export function saveReviewScores(cycleId, personId, reviewerId, reviewType, scores, comments = "") {
  const cycle = getCycle(cycleId);
  if (!cycle) {
    throw new HttpError(404, "评价批次不存在");
  }
  let submission = getReviewSubmissionRow(cycleId, personId, reviewerId, reviewType);
  if (!submission) {
    getReviewForm(cycleId, personId, reviewerId, reviewType);
    submission = getReviewSubmissionRow(cycleId, personId, reviewerId, reviewType);
  }
  const normalizedScores = Object.fromEntries(
    Object.entries(scores ?? {}).map(([itemId, score]) => [itemId, Number(score)])
  );
  for (const value of Object.values(normalizedScores)) {
    if (![0, 1, 3].includes(value)) {
      throw new HttpError(400, "评分值仅允许 0、1、3");
    }
  }
  const itemsById = new Map(
    cycle.framework.dimensions
      .flatMap((dimension) => dimension.categories)
      .flatMap((category) => category.items)
      .map((item) => [item.id, item])
  );
  const result = calculateEvaluationResult(cycle.framework, normalizedScores);

  runInTransaction(() => {
    database.prepare("DELETE FROM review_submission_scores WHERE submission_id = ?").run(submission.id);
    const insertScore = database.prepare(
      `INSERT INTO review_submission_scores
        (id, submission_id, score_item_id, score_value, weighted_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const timestamp = now();
    for (const [itemId, score] of Object.entries(normalizedScores)) {
      const item = itemsById.get(itemId);
      if (!item) {
        continue;
      }
      insertScore.run(
        randomUUID(),
        submission.id,
        itemId,
        score,
        Number(score) * Number(item.weight ?? 1),
        timestamp,
        timestamp
      );
    }
    database
      .prepare(
        `UPDATE review_submissions
         SET comments = ?, status = 'draft', raw_score = ?, weighted_score = ?, weighted_max_score = ?, score_rate = ?, key_score_rate = ?, level_id = ?, level_name = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        comments,
        result.rawScore,
        result.weightedScore,
        result.weightedMaxScore,
        result.scoreRate,
        result.keyScoreRate,
        result.levelId,
        result.levelName,
        timestamp,
        submission.id
      );
  });
  return getReviewForm(cycleId, personId, reviewerId, reviewType);
}

export function submitReview(cycleId, personId, reviewerId, reviewType, comments = "") {
  let submission = getReviewSubmissionRow(cycleId, personId, reviewerId, reviewType);
  if (!submission) {
    throw new HttpError(404, "尚未开始评分");
  }
  const scores = getReviewSubmissionScoresMap(submission.id);
  const cycle = getCycle(cycleId);
  const result = calculateEvaluationResult(cycle.framework, scores);
  const status = reviewType === "supervisor" ? "approved" : "submitted";
  runInTransaction(() => {
    database
      .prepare(
        `UPDATE review_submissions
         SET comments = ?, status = ?, raw_score = ?, weighted_score = ?, weighted_max_score = ?, score_rate = ?, key_score_rate = ?, level_id = ?, level_name = ?, submitted_at = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END, updated_at = ?
         WHERE id = ?`
      )
      .run(
        comments,
        status,
        result.rawScore,
        result.weightedScore,
        result.weightedMaxScore,
        result.scoreRate,
        result.keyScoreRate,
        result.levelId,
        result.levelName,
        now(),
        status,
        status === "approved" ? now() : null,
        now(),
        submission.id
      );
    syncAggregateEvaluation(cycleId, personId);
  });
  return getReviewForm(cycleId, personId, reviewerId, reviewType);
}

export function changeReviewStatus(submissionId, status) {
  if (!["approved", "rejected"].includes(status)) {
    throw new HttpError(400, "审核状态不合法");
  }
  const submission = database.prepare("SELECT * FROM review_submissions WHERE id = ?").get(submissionId);
  if (!submission) {
    throw new HttpError(404, "评审记录不存在");
  }
  database
    .prepare(
      `UPDATE review_submissions
       SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END, rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_at END, updated_at = ?
       WHERE id = ?`
    )
    .run(status, status, now(), status, now(), now(), submissionId);
  syncAggregateEvaluation(submission.cycle_id, submission.person_id);
  return database.prepare("SELECT * FROM review_submissions WHERE id = ?").get(submissionId);
}
