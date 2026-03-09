const MAX_SCORE_PER_ITEM = 3;

function round(value) {
  return Math.round(value * 10000) / 10000;
}

export function getAllItems(framework) {
  return framework.dimensions.flatMap((dimension) =>
    dimension.categories.flatMap((category) =>
      category.items.map((item) => ({
        ...item,
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        categoryId: category.id,
        categoryName: category.name
      }))
    )
  );
}

export function calculateEvaluationResult(framework, scores = {}) {
  const items = getAllItems(framework);
  let rawScore = 0;
  let weightedScore = 0;
  let weightedMaxScore = 0;
  let keyWeightedScore = 0;
  let keyWeightedMaxScore = 0;
  let hasZeroKeyScore = false;

  const dimensionSummaryMap = new Map();

  for (const item of items) {
    const score = Number(scores[item.id] ?? 0);
    const weight = Number(item.weight ?? 1);
    const maxWeightedScore = MAX_SCORE_PER_ITEM * weight;
    const weightedItemScore = score * weight;

    rawScore += score;
    weightedScore += weightedItemScore;
    weightedMaxScore += maxWeightedScore;

    const dimensionSummary = dimensionSummaryMap.get(item.dimensionId) ?? {
      dimensionId: item.dimensionId,
      dimensionName: item.dimensionName,
      rawScore: 0,
      weightedScore: 0,
      weightedMaxScore: 0,
      scoreRate: 0
    };

    dimensionSummary.rawScore += score;
    dimensionSummary.weightedScore += weightedItemScore;
    dimensionSummary.weightedMaxScore += maxWeightedScore;
    dimensionSummaryMap.set(item.dimensionId, dimensionSummary);

    if (item.isKeyItem) {
      keyWeightedScore += weightedItemScore;
      keyWeightedMaxScore += maxWeightedScore;
      if (score === 0) {
        hasZeroKeyScore = true;
      }
    }
  }

  const dimensionSummaries = [...dimensionSummaryMap.values()].map((dimension) => ({
    ...dimension,
    scoreRate: dimension.weightedMaxScore
      ? round(dimension.weightedScore / dimension.weightedMaxScore)
      : 0
  }));

  const scoreRate = weightedMaxScore ? round(weightedScore / weightedMaxScore) : 0;
  const keyScoreRate = keyWeightedMaxScore ? round(keyWeightedScore / keyWeightedMaxScore) : null;

  const level = determineLevel(framework.levels, scoreRate, {
    keyScoreRate,
    hasZeroKeyScore,
    hasKeyItems: keyWeightedMaxScore > 0
  });

  return {
    rawScore,
    weightedScore: round(weightedScore),
    weightedMaxScore: round(weightedMaxScore),
    scoreRate,
    keyScoreRate,
    hasZeroKeyScore,
    levelId: level?.id ?? null,
    levelName: level?.name ?? "未定级",
    dimensionSummaries
  };
}

export function determineLevel(levels, scoreRate, context) {
  const sortedLevels = [...levels].sort((left, right) => right.order - left.order);
  return (
    sortedLevels.find((level) => {
      const minRate = Number(level.minRate ?? 0);
      const maxRate =
        level.maxRate === null || level.maxRate === undefined ? 1 : Number(level.maxRate);
      if (scoreRate < minRate || scoreRate > maxRate) {
        return false;
      }

      const keyRule = level.keyRule;
      if (!keyRule?.enabled || !context.hasKeyItems) {
        return true;
      }

      if (
        keyRule.minKeyRate !== null &&
        keyRule.minKeyRate !== undefined &&
        (context.keyScoreRate ?? 0) < Number(keyRule.minKeyRate)
      ) {
        return false;
      }

      if (keyRule.disallowZeroKeyScore && context.hasZeroKeyScore) {
        return false;
      }

      return true;
    }) ?? null
  );
}

export function buildEvaluationForm(framework, scores = {}) {
  return {
    scoreOptions: framework.scoreOptions,
    weightOptions: framework.weightOptions,
    dimensions: framework.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      categories: dimension.categories.map((category) => ({
        id: category.id,
        name: category.name,
        items: category.items.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          weight: item.weight,
          isKeyItem: Boolean(item.isKeyItem),
          maxWeightedScore: round(MAX_SCORE_PER_ITEM * Number(item.weight ?? 1)),
          score: Number(scores[item.id] ?? 0)
        }))
      }))
    }))
  };
}

export function summarizeAnalytics(cycle, people, evaluations) {
  const levelBuckets = new Map();
  const dimensionBuckets = new Map();
  const personalResults = [];

  for (const person of people) {
    const evaluation = evaluations.find((item) => item.personId === person.id);
    if (!evaluation?.result) {
      continue;
    }

    personalResults.push({
      personId: person.id,
      personName: person.name,
      employeeNo: person.employeeNo,
      department: person.department,
      position: person.position,
      status: evaluation.status,
      ...evaluation.result
    });

    const currentLevel = levelBuckets.get(evaluation.result.levelName) ?? {
      levelName: evaluation.result.levelName,
      count: 0
    };
    currentLevel.count += 1;
    levelBuckets.set(evaluation.result.levelName, currentLevel);

    for (const dimension of evaluation.result.dimensionSummaries) {
      const bucket = dimensionBuckets.get(dimension.dimensionId) ?? {
        dimensionId: dimension.dimensionId,
        dimensionName: dimension.dimensionName,
        totalRate: 0,
        count: 0
      };
      bucket.totalRate += dimension.scoreRate;
      bucket.count += 1;
      dimensionBuckets.set(dimension.dimensionId, bucket);
    }
  }

  const total = personalResults.length || 1;

  return {
    cycleId: cycle.id,
    cycleName: cycle.name,
    levelDistribution: [...levelBuckets.values()].map((item) => ({
      ...item,
      percentage: round(item.count / total)
    })),
    dimensionAverages: [...dimensionBuckets.values()].map((item) => ({
      dimensionId: item.dimensionId,
      dimensionName: item.dimensionName,
      averageScoreRate: round(item.totalRate / item.count)
    })),
    personalResults: personalResults.sort((left, right) => right.scoreRate - left.scoreRate)
  };
}
