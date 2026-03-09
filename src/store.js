import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildEvaluationForm, calculateEvaluationResult, summarizeAnalytics } from "./scoring.js";

const storePath = path.resolve(process.cwd(), "data/store.json");

function readStore() {
  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureCycleEditable(cycle) {
  if (!cycle) {
    throw new Error("评价批次不存在");
  }
  if (cycle.status !== "draft") {
    throw new Error("仅草稿批次允许修改评价体系");
  }
}

function findCycle(store, cycleId) {
  return store.cycles.find((cycle) => cycle.id === cycleId);
}

function findEvaluation(store, cycleId, personId) {
  return store.evaluations.find(
    (evaluation) => evaluation.cycleId === cycleId && evaluation.personId === personId
  );
}

function sanitizeFramework(framework) {
  return {
    id: framework.id ?? randomUUID(),
    name: framework.name ?? "未命名评价体系",
    scoreOptions: [0, 1, 3],
    weightOptions: [1, 1.5, 2],
    levels: (framework.levels ?? [])
      .map((level, index) => ({
        id: level.id ?? randomUUID(),
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
      id: dimension.id ?? randomUUID(),
      name: dimension.name?.trim() || "未命名维度",
      categories: (dimension.categories ?? []).map((category) => ({
        id: category.id ?? randomUUID(),
        name: category.name?.trim() || "未命名分类",
        items: (category.items ?? []).map((item) => ({
          id: item.id ?? randomUUID(),
          title: item.title?.trim() || "未命名评分项",
          description: item.description?.trim() || "",
          weight: [1, 1.5, 2].includes(Number(item.weight)) ? Number(item.weight) : 1,
          isKeyItem: Boolean(item.isKeyItem)
        }))
      }))
    }))
  };
}

function enrichEvaluation(cycle, people, evaluation) {
  return {
    ...evaluation,
    person: people.find((person) => person.id === evaluation.personId) ?? null,
    form: buildEvaluationForm(cycle.framework, evaluation.scores),
    result: calculateEvaluationResult(cycle.framework, evaluation.scores)
  };
}

export function getPublicAppState(role) {
  const store = readStore();
  return {
    users: role === "admin" ? store.users.map(({ password, ...user }) => user) : undefined,
    people: store.people,
    cycles: store.cycles,
    evaluations: store.evaluations.map(({ scores, ...evaluation }) => evaluation)
  };
}

export function authenticate(username, password) {
  const store = readStore();
  const user = store.users.find(
    (item) => item.username === username && item.password === password
  );
  if (!user) {
    return null;
  }
  const { password: _password, ...safeUser } = user;
  return safeUser;
}

export function createCycle(input) {
  const store = readStore();
  const templateFramework =
    clone(store.cycles.at(-1)?.framework) ??
    sanitizeFramework({
      name: "默认评价体系",
      levels: [],
      dimensions: []
    });
  const cycle = {
    id: randomUUID(),
    name: input.name?.trim() || `评价批次 ${store.cycles.length + 1}`,
    status: "draft",
    createdAt: new Date().toISOString(),
    framework: templateFramework
  };
  store.cycles.push(cycle);
  writeStore(store);
  return cycle;
}

export function updateCycleStatus(cycleId, status) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  if (!cycle) {
    throw new Error("评价批次不存在");
  }
  cycle.status = status;
  writeStore(store);
  return cycle;
}

export function updateFramework(cycleId, frameworkInput) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  ensureCycleEditable(cycle);
  cycle.framework = sanitizeFramework(frameworkInput);
  writeStore(store);
  return cycle.framework;
}

export function createPerson(input) {
  const store = readStore();
  const person = {
    id: randomUUID(),
    employeeNo: input.employeeNo?.trim() || "",
    name: input.name?.trim() || "未命名人员",
    department: input.department?.trim() || "",
    position: input.position?.trim() || ""
  };
  store.people.push(person);
  writeStore(store);
  return person;
}

export function updatePerson(personId, input) {
  const store = readStore();
  const person = store.people.find((item) => item.id === personId);
  if (!person) {
    throw new Error("人员不存在");
  }
  person.employeeNo = input.employeeNo?.trim() || "";
  person.name = input.name?.trim() || "未命名人员";
  person.department = input.department?.trim() || "";
  person.position = input.position?.trim() || "";
  writeStore(store);
  return person;
}

export function getEvaluationForm(cycleId, personId) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  if (!cycle) {
    throw new Error("评价批次不存在");
  }
  const person = store.people.find((item) => item.id === personId);
  if (!person) {
    throw new Error("人员不存在");
  }

  let evaluation = findEvaluation(store, cycleId, personId);
  if (!evaluation) {
    evaluation = {
      id: randomUUID(),
      cycleId,
      personId,
      status: "draft",
      scores: {}
    };
    store.evaluations.push(evaluation);
    writeStore(store);
  }

  return {
    cycle,
    person,
    evaluation: enrichEvaluation(cycle, store.people, evaluation)
  };
}

export function saveEvaluationScores(cycleId, personId, scores) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  if (!cycle) {
    throw new Error("评价批次不存在");
  }
  const person = store.people.find((item) => item.id === personId);
  if (!person) {
    throw new Error("人员不存在");
  }

  let evaluation = findEvaluation(store, cycleId, personId);
  if (!evaluation) {
    evaluation = {
      id: randomUUID(),
      cycleId,
      personId,
      status: "draft",
      scores: {}
    };
    store.evaluations.push(evaluation);
  }

  evaluation.scores = Object.fromEntries(
    Object.entries(scores ?? {}).map(([itemId, score]) => [itemId, Number(score)])
  );
  evaluation.result = calculateEvaluationResult(cycle.framework, evaluation.scores);
  writeStore(store);

  return enrichEvaluation(cycle, store.people, evaluation);
}

export function submitEvaluation(cycleId, personId) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  if (!cycle) {
    throw new Error("评价批次不存在");
  }
  const evaluation = findEvaluation(store, cycleId, personId);
  if (!evaluation) {
    throw new Error("尚未开始评分");
  }
  evaluation.status = "submitted";
  evaluation.result = calculateEvaluationResult(cycle.framework, evaluation.scores);
  writeStore(store);
  return enrichEvaluation(cycle, store.people, evaluation);
}

export function getCycleAnalytics(cycleId) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  if (!cycle) {
    throw new Error("评价批次不存在");
  }
  const cycleEvaluations = store.evaluations
    .filter((evaluation) => evaluation.cycleId === cycleId)
    .map((evaluation) => ({
      ...evaluation,
      result: evaluation.result ?? calculateEvaluationResult(cycle.framework, evaluation.scores)
    }));
  return summarizeAnalytics(cycle, store.people, cycleEvaluations);
}

export function getPersonResult(cycleId, personId) {
  const store = readStore();
  const cycle = findCycle(store, cycleId);
  const evaluation = findEvaluation(store, cycleId, personId);
  const person = store.people.find((item) => item.id === personId);
  if (!cycle || !person || !evaluation) {
    throw new Error("结果不存在");
  }
  const fullEvaluation = enrichEvaluation(cycle, store.people, evaluation);
  return {
    cycle,
    person,
    evaluation: fullEvaluation
  };
}
