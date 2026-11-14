/**
 * 重合群组基准复用 —— 共用实现（唯一一份）。
 *
 * 背景：行业对标留存里多个留存方案引用相同对比指标和基准值，每次对标更新
 * 都会重复计算相同留存差距，甚至把只相差一个画像区间的人群全部重算。
 *
 * 本模块把「哪些要重算、哪些沿用历史」的判定收拢成一份纯函数实现，
 * 页面、服务层、校验脚本都从这里取，不再各自写一遍。
 *
 * 设计约定（粒度与失效范围）：
 * - 复用键 = 对比指标 + 基准值 + 观察窗口。同键方案共享同一份基准快照。
 * - 重合判定粒度 = 画像分层区间（留存率 10% 一档）。两个方案在相同
 *   （对比指标， 观察窗口）下，按分层区间交集判定重合人群。
 * - 基准失效范围 = 单个复用键 × 单个分层区间。某层实测留存变化超过容差，
 *   只失效该层缓存的差距结论；其它分层、其它观察窗口一律不动。
 * - 并发提交 = 乐观版本锁。两个任务基于同一版本开始校验，先完成完整校验
 *   并提交者把版本 +1；后到者提交时发现基线版本已变，记为冲突，不覆盖。
 */

/** 差值变化容差（百分点）：不超过它视为「未变化」，继续沿用历史结论。 */
export const GAP_TOLERANCE_PP = 0.05

/** 画像分层区间：重合人群的判定粒度，按留存率 10% 一档切分。 */
export type StratumInterval = {
  /** 区间下界（含），百分比数值，如 30 表示 30% */
  lower: number
  /** 区间上界（不含），百分比数值，如 40 表示 40% */
  upper: number
}

/** 一个分层区间的一批实测：同一（对比指标， 观察窗口）下该区间人群的实测留存。 */
export type StratumMeasurement = {
  metric: string
  window: string
  interval: StratumInterval
  /** 该分层重合人群规模（人） */
  population: number
  /** 本批实测留存率（%） */
  actualRate: number
  /** 数据批次，如「2026-10 批次」 */
  batch: string
}

/** 某方案在某分层上的历史差距结论（缓存，可复用）。 */
export type GapConclusion = {
  planCode: string
  metric: string
  baselineValue: number
  window: string
  interval: StratumInterval
  population: number
  actualRate: number
  /** 留存差距 = 实测留存率 − 基准值（百分点） */
  gap: number
  batch: string
}

/** 基准快照：同一复用键下所有分层结论的缓存，带乐观锁版本号。 */
export type BaselineSnapshot = {
  key: string
  metric: string
  baselineValue: number
  window: string
  version: number
  batch: string
  conclusions: GapConclusion[]
}

/** 参与复用判定的对标方案。 */
export type ReusePlan = {
  planCode: string
  metric: string
  baselineValue: number
  window: string
}

/** 单个分层的复用判定结果。 */
export type StratumDecision = {
  interval: StratumInterval
  population: number
  previousActual: number
  currentActual: number
  /** 差值变化（百分点），绝对值 */
  drift: number
  /** true = 重算该分层；false = 沿用历史结论 */
  recalculate: boolean
  reason: string
}

/** 一个方案一次对标更新的复用报告。 */
export type PlanReuseReport = {
  planCode: string
  baselineKey: string
  decisions: StratumDecision[]
  recalculatedPopulation: number
  reusedPopulation: number
  reusedBatch: string
  conclusions: GapConclusion[]
}

/** 复用键：对比指标 + 基准值 + 观察窗口。 */
export function baselineKeyOf(metric: string, baselineValue: number, window: string): string {
  return `${metric}|${baselineValue.toFixed(2)}%|${window}`
}

/** 分层键：重合判定的最小单元。 */
export function stratumKeyOf(metric: string, window: string, interval: StratumInterval): string {
  return `${metric}|${window}|${interval.lower}%-${interval.upper}%`
}

/** 区间展示文案，如「30%–40%」。 */
export function formatInterval(interval: StratumInterval): string {
  return `${interval.lower}%–${interval.upper}%`
}

/** 留存差距 = 实测 − 基准，保留两位小数，单位百分点。 */
export function gapOf(actualRate: number, baselineValue: number): number {
  return round2(actualRate - baselineValue)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 比对同一分层的前后两批实测，判定是否需要重算。
 * 差值变化 ≤ 容差 → 沿用历史结论；> 容差 → 只重算该分层。
 */
export function judgeStratum(
  previous: StratumMeasurement,
  current: StratumMeasurement,
  tolerance: number = GAP_TOLERANCE_PP,
): StratumDecision {
  const drift = round2(Math.abs(current.actualRate - previous.actualRate))
  const recalculate = drift > tolerance
  return {
    interval: current.interval,
    population: current.population,
    previousActual: previous.actualRate,
    currentActual: current.actualRate,
    drift,
    recalculate,
    reason: recalculate
      ? `差值变化 ${drift.toFixed(2)}pp，超过容差 ${tolerance.toFixed(2)}pp，重算该分层`
      : `差值变化 ${drift.toFixed(2)}pp，未超容差，沿用 ${previous.batch} 结论`,
  }
}

/**
 * 为一个对标方案生成复用报告（共用实现的核心入口）。
 *
 * @param plan        待更新的对标方案
 * @param previous    上一批分层实测（按分层键索引）
 * @param current     本批分层实测
 * @param history     该方案的历史差距结论（按分层键索引）
 * @param tolerance   差值变化容差
 */
export function planReuse(
  plan: ReusePlan,
  previous: ReadonlyMap<string, StratumMeasurement>,
  current: StratumMeasurement[],
  history: ReadonlyMap<string, GapConclusion>,
  tolerance: number = GAP_TOLERANCE_PP,
): PlanReuseReport {
  const decisions: StratumDecision[] = []
  const conclusions: GapConclusion[] = []
  let recalculatedPopulation = 0
  let reusedPopulation = 0
  let reusedBatch = ''

  for (const measurement of current) {
    const sKey = stratumKeyOf(plan.metric, plan.window, measurement.interval)
    const before = previous.get(sKey)
    const cached = history.get(sKey)

    // 没有上一批实测或没有历史结论的分层，首次计算，全量重算。
    if (!before || !cached) {
      decisions.push({
        interval: measurement.interval,
        population: measurement.population,
        previousActual: before ? before.actualRate : measurement.actualRate,
        currentActual: measurement.actualRate,
        drift: before ? round2(Math.abs(measurement.actualRate - before.actualRate)) : 0,
        recalculate: true,
        reason: '无历史结论，首次计算该分层',
      })
      recalculatedPopulation += measurement.population
      conclusions.push(buildConclusion(plan, measurement))
      continue
    }

    const decision = judgeStratum(before, measurement, tolerance)
    decisions.push(decision)
    if (decision.recalculate) {
      recalculatedPopulation += measurement.population
      conclusions.push(buildConclusion(plan, measurement))
    } else {
      reusedPopulation += measurement.population
      reusedBatch = cached.batch
      // 未变化：继续沿用自己的历史结论，不重算。
      conclusions.push(cached)
    }
  }

  return {
    planCode: plan.planCode,
    baselineKey: baselineKeyOf(plan.metric, plan.baselineValue, plan.window),
    decisions,
    recalculatedPopulation,
    reusedPopulation,
    reusedBatch,
    conclusions,
  }
}

function buildConclusion(plan: ReusePlan, measurement: StratumMeasurement): GapConclusion {
  return {
    planCode: plan.planCode,
    metric: plan.metric,
    baselineValue: plan.baselineValue,
    window: plan.window,
    interval: measurement.interval,
    population: measurement.population,
    actualRate: measurement.actualRate,
    gap: gapOf(measurement.actualRate, plan.baselineValue),
    batch: measurement.batch,
  }
}

/** 把复用报告固化为新的基准快照（版本 +1）。 */
export function nextSnapshot(snapshot: BaselineSnapshot, report: PlanReuseReport, batch: string): BaselineSnapshot {
  return {
    ...snapshot,
    version: snapshot.version + 1,
    batch,
    conclusions: report.conclusions,
  }
}

export type CommitResult =
  | { ok: true; snapshot: BaselineSnapshot }
  | { ok: false; conflict: true; message: string; snapshot: BaselineSnapshot }

/**
 * 乐观并发提交：两个任务同时更新同一基准时，先完成完整校验并提交者胜出；
 * 后到者基线版本已过期，返回冲突，不覆盖已提交的版本。
 *
 * @param current      当前存储里的快照（可能已被别的任务更新）
 * @param baseVersion  本任务开始校验时读到的版本
 * @param next         本任务校验通过后准备写入的快照
 */
export function commitSnapshot(
  current: BaselineSnapshot,
  baseVersion: number,
  next: BaselineSnapshot,
): CommitResult {
  if (current.version !== baseVersion) {
    return {
      ok: false,
      conflict: true,
      message:
        `基准「${current.key}」已被另一任务更新到 v${current.version}` +
        `（本任务基于 v${baseVersion} 校验），按并发规则不覆盖，记为冲突`,
      snapshot: current,
    }
  }
  return { ok: true, snapshot: next }
}
