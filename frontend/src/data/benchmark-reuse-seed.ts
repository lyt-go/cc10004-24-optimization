import type {
  BaselineSnapshot,
  GapConclusion,
  ReusePlan,
  StratumMeasurement,
} from './baseline-reuse'
import { gapOf, stratumKeyOf } from './baseline-reuse'

/**
 * 验收场景种子数据：BENC-0001 与 BENC-0002 覆盖同一活跃用户留存人群。
 *
 * - 对比指标：活跃用户次月留存率；观察窗口：2026-10（历史批次）→ 2026-11（本批更新）
 * - 共同人群 12,840 人，按画像分层区间（10% 一档）分布
 * - 只有 30%–40% 区间的 2,316 人差值变化超过容差 → 只重算这一层
 * - 其余分层沿用 10 月批次历史结论
 */

export const REUSE_METRIC = '活跃用户次月留存率'
export const PREV_WINDOW = '2026-10'
export const CURR_WINDOW = '2026-10'
export const PREV_BATCH = '2026-10 批次'
export const CURR_BATCH = '2026-11 批次'

/** 两个对标方案：同一指标、同一观察窗口、不同基准值 → 各自持有基准快照。 */
export const REUSE_PLANS: ReusePlan[] = [
  { planCode: 'BENC-0001', metric: REUSE_METRIC, baselineValue: 36.75, window: CURR_WINDOW },
  { planCode: 'BENC-0002', metric: REUSE_METRIC, baselineValue: 41.2, window: CURR_WINDOW },
]

/** 上一批（2026-10 批次）分层实测。 */
export const PREV_MEASUREMENTS: StratumMeasurement[] = [
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 0, upper: 10 }, population: 1050, actualRate: 4.2, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 10, upper: 20 }, population: 1180, actualRate: 14.6, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 20, upper: 30 }, population: 1394, actualRate: 25.1, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 30, upper: 40 }, population: 2316, actualRate: 34.8, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 40, upper: 50 }, population: 1720, actualRate: 44.3, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 50, upper: 60 }, population: 1560, actualRate: 53.4, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 60, upper: 70 }, population: 1330, actualRate: 62.1, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 70, upper: 80 }, population: 1060, actualRate: 71.5, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 80, upper: 90 }, population: 760, actualRate: 82.3, batch: PREV_BATCH },
  { metric: REUSE_METRIC, window: PREV_WINDOW, interval: { lower: 90, upper: 100 }, population: 470, actualRate: 93.6, batch: PREV_BATCH },
]

/** 本批（2026-11 批次）分层实测：仅 30%–40% 区间变化超过容差。 */
export const CURR_MEASUREMENTS: StratumMeasurement[] = [
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 0, upper: 10 }, population: 1050, actualRate: 4.22, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 10, upper: 20 }, population: 1180, actualRate: 14.58, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 20, upper: 30 }, population: 1394, actualRate: 25.12, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 30, upper: 40 }, population: 2316, actualRate: 36.95, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 40, upper: 50 }, population: 1720, actualRate: 44.31, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 50, upper: 60 }, population: 1560, actualRate: 53.38, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 60, upper: 70 }, population: 1330, actualRate: 62.12, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 70, upper: 80 }, population: 1060, actualRate: 71.49, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 80, upper: 90 }, population: 760, actualRate: 82.31, batch: CURR_BATCH },
  { metric: REUSE_METRIC, window: CURR_WINDOW, interval: { lower: 90, upper: 100 }, population: 470, actualRate: 93.59, batch: CURR_BATCH },
]

/** 共同人群总数（重合核对记录口径：12,840 人）。 */
export const COMMON_POPULATION = PREV_MEASUREMENTS.reduce((sum, item) => sum + item.population, 0)

function historyKeyOf(conclusion: GapConclusion): string {
  return stratumKeyOf(conclusion.metric, conclusion.window, conclusion.interval)
}

/** 由上一批实测推导某方案的历史差距结论（10 月批次缓存）。 */
export function buildHistory(plan: ReusePlan): Map<string, GapConclusion> {
  const map = new Map<string, GapConclusion>()
  for (const measurement of PREV_MEASUREMENTS) {
    const conclusion: GapConclusion = {
      planCode: plan.planCode,
      metric: plan.metric,
      baselineValue: plan.baselineValue,
      window: plan.window,
      interval: measurement.interval,
      population: measurement.population,
      actualRate: measurement.actualRate,
      gap: gapOf(measurement.actualRate, plan.baselineValue),
      batch: PREV_BATCH,
    }
    map.set(historyKeyOf(conclusion), conclusion)
  }
  return map
}

/** 上一批实测按分层键索引，供复用判定比对。 */
export function previousMeasurementMap(): Map<string, StratumMeasurement> {
  const map = new Map<string, StratumMeasurement>()
  for (const measurement of PREV_MEASUREMENTS) {
    map.set(stratumKeyOf(measurement.metric, measurement.window, measurement.interval), measurement)
  }
  return map
}

/** 初始基准快照：v3，内容为 10 月批次历史结论。 */
export function buildInitialSnapshot(plan: ReusePlan): BaselineSnapshot {
  return {
    key: `${plan.metric}|${plan.baselineValue.toFixed(2)}%|${plan.window}`,
    metric: plan.metric,
    baselineValue: plan.baselineValue,
    window: plan.window,
    version: 3,
    batch: PREV_BATCH,
    conclusions: [...buildHistory(plan).values()],
  }
}
