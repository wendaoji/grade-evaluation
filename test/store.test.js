import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("store initializes sqlite database from JSON seed", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grade-eval-db-"));
  const dbFile = path.join(tempDir, "grade-evaluation.db");
  const seedFile = path.resolve(process.cwd(), "data/store.json");

  process.env.GRADE_EVAL_DB_PATH = dbFile;
  process.env.GRADE_EVAL_SEED_PATH = seedFile;

  const storeModule = await import(
    `${pathToFileURL(path.resolve(process.cwd(), "src/store.js")).href}?test=${Date.now()}`
  );

  const appState = storeModule.getPublicAppState("admin");
  assert.ok(fs.existsSync(dbFile));
  assert.equal(appState.cycles.length >= 1, true);
  assert.equal(appState.people.length >= 1, true);
  assert.equal(appState.users.length >= 1, true);

  delete process.env.GRADE_EVAL_DB_PATH;
  delete process.env.GRADE_EVAL_SEED_PATH;
});

test("store provides paginated people list and hashed login support", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grade-eval-db-"));
  const dbFile = path.join(tempDir, "grade-evaluation.db");
  const seedFile = path.resolve(process.cwd(), "data/store.json");

  process.env.GRADE_EVAL_DB_PATH = dbFile;
  process.env.GRADE_EVAL_SEED_PATH = seedFile;

  const storeModule = await import(
    `${pathToFileURL(path.resolve(process.cwd(), "src/store.js")).href}?test=${Date.now()}-2`
  );

  const user = storeModule.authenticate("admin", "admin123");
  assert.equal(user.username, "admin");

  const peoplePage = storeModule.getPeopleList({
    page: 1,
    pageSize: 1,
    keyword: "张",
    sortBy: "employeeNo",
    sortOrder: "asc"
  });
  assert.equal(peoplePage.items.length, 1);
  assert.equal(peoplePage.items[0].name, "张三");
  assert.equal(peoplePage.pagination.total, 1);

  delete process.env.GRADE_EVAL_DB_PATH;
  delete process.env.GRADE_EVAL_SEED_PATH;
});

test("store imports people batch and exports cycle results", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grade-eval-db-"));
  const dbFile = path.join(tempDir, "grade-evaluation.db");
  const seedFile = path.resolve(process.cwd(), "data/store.json");

  process.env.GRADE_EVAL_DB_PATH = dbFile;
  process.env.GRADE_EVAL_SEED_PATH = seedFile;

  const storeModule = await import(
    `${pathToFileURL(path.resolve(process.cwd(), "src/store.js")).href}?test=${Date.now()}-3`
  );

  const imported = storeModule.importPeopleBatch({
    mode: "merge",
    content: "employeeNo,name,department,position\nE100,赵六,平台部,架构师"
  });
  assert.equal(imported.created, 1);

  const peoplePage = storeModule.getPeopleList({
    page: 1,
    pageSize: 10,
    keyword: "赵六",
    sortBy: "employeeNo",
    sortOrder: "asc"
  });
  assert.equal(peoplePage.items[0].department, "平台部");

  const exported = storeModule.exportCycleResults("cycle-2026-h1", "csv");
  assert.equal(exported.contentType.includes("text/csv"), true);
  assert.equal(exported.filename, "cycle-2026-h1-results.csv");

  delete process.env.GRADE_EVAL_DB_PATH;
  delete process.env.GRADE_EVAL_SEED_PATH;
});
