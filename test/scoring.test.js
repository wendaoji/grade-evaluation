import test from "node:test";
import assert from "node:assert/strict";
import { buildEvaluationForm, calculateEvaluationResult, summarizeAnalytics } from "../src/scoring.js";

const framework = {
  scoreOptions: [0, 1, 3],
  weightOptions: [1, 1.5, 2],
  levels: [
    { id: "l1", name: "L1", order: 1, minRate: 0, maxRate: 0.4 },
    { id: "l2", name: "L2", order: 2, minRate: 0.4, maxRate: 0.8 },
    {
      id: "l3",
      name: "L3",
      order: 3,
      minRate: 0.8,
      maxRate: 1,
      keyRule: { enabled: true, minKeyRate: 0.7, disallowZeroKeyScore: true }
    }
  ],
  dimensions: [
    {
      id: "d1",
      name: "IT技术能力",
      categories: [
        {
          id: "c1",
          name: "后端能力",
          items: [
            { id: "i1", title: "接口设计", weight: 2, isKeyItem: true },
            { id: "i2", title: "调试定位", weight: 1, isKeyItem: false }
          ]
        }
      ]
    }
  ]
};

test("calculateEvaluationResult computes weighted scores and level", () => {
  const result = calculateEvaluationResult(framework, { i1: 3, i2: 1 });
  assert.equal(result.rawScore, 4);
  assert.equal(result.weightedScore, 7);
  assert.equal(result.weightedMaxScore, 9);
  assert.equal(result.scoreRate, 0.7778);
  assert.equal(result.levelName, "L2");
});

test("calculateEvaluationResult blocks high level when key rule fails", () => {
  const result = calculateEvaluationResult(framework, { i1: 1, i2: 3 });
  assert.equal(result.scoreRate, 0.5556);
  assert.equal(result.keyScoreRate, 0.3333);
  assert.equal(result.levelName, "L2");
});

test("buildEvaluationForm exposes score and max weighted score", () => {
  const form = buildEvaluationForm(framework, { i1: 3 });
  assert.equal(form.dimensions[0].categories[0].items[0].score, 3);
  assert.equal(form.dimensions[0].categories[0].items[0].maxWeightedScore, 6);
});

test("summarizeAnalytics aggregates level distribution and dimensions", () => {
  const analytics = summarizeAnalytics(
    { id: "cycle-1", name: "测试批次" },
    [{ id: "p1", name: "张三", employeeNo: "E001", department: "研发", position: "工程师" }],
    [
      {
        personId: "p1",
        status: "submitted",
        result: calculateEvaluationResult(framework, { i1: 3, i2: 3 })
      }
    ]
  );

  assert.equal(analytics.levelDistribution[0].levelName, "L3");
  assert.equal(analytics.dimensionAverages[0].averageScoreRate, 1);
  assert.equal(analytics.personalResults[0].personName, "张三");
  assert.equal(analytics.departmentDistribution[0].department, "研发");
  assert.equal(analytics.positionDistribution[0].position, "工程师");
});
