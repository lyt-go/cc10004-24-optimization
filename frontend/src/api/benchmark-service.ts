import {
  baselineKeyOf,
  commitSnapshot,
  formatInterval,
  nextSnapshot,
  planReuse,
  stratumKeyOf,
} from '@/data/baseline-reuse'
import type {
  BaselineSnapshot,
  PlanReuseReport,
  ReusePlan,
} from '@/data/baseline-reuse'
import {
  COMMON_POPULATION,
  CURR_BATCH,
  CURR_MEASUREMENTS,
  PREV_BATCH,
  REUSE_PLANS,
  buildHistory,
  buildInitialSnapshot,
  previousMeasurementMap,
} from '@/data/benchmark-reuse-seed'

/**
 * 竞品对标的基准复用服务：把种子数据喂给共用实现（baseline-reuse.ts），
 * 产出视图模型；快照与重合核对记录持久化在 localStorage。
 */

const SNAPSHOT_STORAGE_KEY = 'data-product-ops:benchmark-snapshots'
const CHECKLOG_STORAGE_KEY = 'data-product-ops:benchmark-checklog'

/** 重合核对记录：一次复用判定留下一条，供审计回看。 */
export type OverlapCheckRecord = {
  id: string
  runAt: string
  plans: { planCode: string; baselineValue: number }[]
  commonPopulation: number
  recalculatedPopulation: number
  recalculatedIntervals: string[]
  reusedPopulation: number
  reusedBatch: string
}

export type ReuseOverview = {
  metric: string
  window: string
  plans: ReusePlan[]
  commonPopulation: number
  recalculatedPopulation: number
  reusedPopulation: number
  reusedBatch: string
  reports: PlanReuseReport[]
  snapshots: BaselineSnapshot[]
  checkRecords: OverlapCheckRecord[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 按复用键定位快照，找不到就回退到初始快照。 */
function findSnapshot(snapshots: BaselineSnapshot[], plan: ReusePlan): BaselineSnapshot {
  const key = baselineKeyOf(plan.metric, plan.baselineValue, plan.window)
  return snapshots.find((item) => item.key === key) ?? buildInitialSnapshot(plan)
}

/** 把快照里的历史结论按分层键索引，交给共用复用判定。 */
function historyMapOf(snapshot: BaselineSnapshot) {
  return new Map(
    snapshot.conclusions.map((item) => [
      stratumKeyOf(item.metric, item.window, item.interval),
      item,
    ]),
  )
}

function readSnapshots(): BaselineSnapshot[] {
  const fallback = REUSE_PLANS.map((plan) => buildInitialSnapshot(plan))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as BaselineSnapshot[]
  } catch {
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

function writeSnapshots(snapshots: BaselineSnapshot[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots))
  }
}

function readCheckLog(): OverlapCheckRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(CHECKLOG_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as OverlapCheckRecord[]
  } catch {
    return []
  }
}

function appendCheckLog(record: OverlapCheckRecord): OverlapCheckRecord[] {
  const next = [record, ...readCheckLog()].slice(0, 20)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CHECKLOG_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

/**
 * 执行一次对标更新：对每个方案跑共用复用判定，只重算差值变化的分层，
 * 未变化的分层沿用自己的历史结论；判定结果固化为新快照并写一条重合核对记录。
 */
export function runReuseUpdate(): ReuseOverview {
  const previous = previousMeasurementMap()
  const snapshots = readSnapshots()
  const reports: PlanReuseReport[] = []
  const nextSnapshots: BaselineSnapshot[] = []

  for (const plan of REUSE_PLANS) {
    const snapshot = findSnapshot(snapshots, plan)
    const history = historyMapOf(snapshot)
    // 共用实现：同一套 planReuse，两个方案都走这里，不再各自写重复逻辑。
    const report = planReuse(plan, previous, CURR_MEASUREMENTS, history)
    reports.push(report)
    nextSnapshots.push(nextSnapshot(snapshot, report, CURR_BATCH))
  }

  writeSnapshots(nextSnapshots)

  const recalculated = reports[0]?.recalculatedPopulation ?? 0
  const reused = reports[0]?.reusedPopulation ?? 0
  const recalculatedIntervals = (reports[0]?.decisions ?? [])
    .filter((decision) => decision.recalculate)
    .map((decision) => formatInterval(decision.interval))

  const checkRecords = appendCheckLog({
    id: `CHECK-${Date.now()}`,
    runAt: new Date().toISOString(),
    plans: REUSE_PLANS.map((plan) => ({ planCode: plan.planCode, baselineValue: plan.baselineValue })),
    commonPopulation: COMMON_POPULATION,
    recalculatedPopulation: recalculated,
    recalculatedIntervals,
    reusedPopulation: reused,
    reusedBatch: reports[0]?.reusedBatch || PREV_BATCH,
  })

  return {
    metric: REUSE_PLANS[0].metric,
    window: REUSE_PLANS[0].window,
    plans: REUSE_PLANS,
    commonPopulation: COMMON_POPULATION,
    recalculatedPopulation: recalculated,
    reusedPopulation: reused,
    reusedBatch: reports[0]?.reusedBatch || PREV_BATCH,
    reports,
    snapshots: nextSnapshots,
    checkRecords,
  }
}

/** 只读视图：不触发重算，用当前快照 + 本批实测给出复用预览。 */
export function loadReuseOverview(): ReuseOverview {
  const previous = previousMeasurementMap()
  const snapshots = readSnapshots()
  const reports = REUSE_PLANS.map((plan) =>
    planReuse(plan, previous, CURR_MEASUREMENTS, historyMapOf(findSnapshot(snapshots, plan))),
  )
  return {
    metric: REUSE_PLANS[0].metric,
    window: REUSE_PLANS[0].window,
    plans: REUSE_PLANS,
    commonPopulation: COMMON_POPULATION,
    recalculatedPopulation: reports[0]?.recalculatedPopulation ?? 0,
    reusedPopulation: reports[0]?.reusedPopulation ?? 0,
    reusedBatch: reports[0]?.reusedBatch || PREV_BATCH,
    reports,
    snapshots,
    checkRecords: readCheckLog(),
  }
}

export type ConcurrentCommitDemo = {
  baselineKey: string
  first: { taskId: string; ok: boolean; message: string }
  second: { taskId: string; ok: boolean; message: string }
}

/**
 * 并发冲突演示：任务甲、乙同时基于同一版本更新同一基准。
 * 甲先完成完整校验并提交（版本 +1）；乙提交时基线版本已过期，
 * 按规则显示冲突，不覆盖甲的版本。
 */
export function simulateConcurrentCommit(): ConcurrentCommitDemo {
  const snapshots = readSnapshots()
  const target = clone(snapshots[0])
  const baseVersion = target.version

  // 任务甲：基于 v{baseVersion} 校验通过，先提交。
  const firstNext = { ...target, version: baseVersion + 1, batch: CURR_BATCH }
  const first = commitSnapshot(target, baseVersion, firstNext)
  if (first.ok) {
    const next = snapshots.map((item) => (item.key === target.key ? first.snapshot : item))
    writeSnapshots(next)
  }

  // 任务乙：同样基于 v{baseVersion} 校验，但提交时存储里已是甲的新版本。
  const stored = readSnapshots().find((item) => item.key === target.key) ?? target
  const secondNext = { ...target, version: baseVersion + 1, batch: CURR_BATCH }
  const second = commitSnapshot(stored, baseVersion, secondNext)

  return {
    baselineKey: target.key,
    first: {
      taskId: '任务甲',
      ok: first.ok,
      message: first.ok
        ? `先完成完整校验，已提交为 v${first.snapshot.version}`
        : '提交失败',
    },
    second: {
      taskId: '任务乙',
      ok: second.ok,
      message: second.ok ? '提交成功' : second.message,
    },
  }
}

/** 重置复用演示数据：快照回到 10 月批次初始版本，清空核对记录。 */
export function resetReuseData(): void {
  writeSnapshots(REUSE_PLANS.map((plan) => buildInitialSnapshot(plan)))
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(CHECKLOG_STORAGE_KEY)
  }
}

/** 供校验脚本复用：无浏览器环境下直接基于种子数据跑一次复用判定。 */
export function runReuseUpdateInMemory(): ReuseOverview {
  const previous = previousMeasurementMap()
  const reports = REUSE_PLANS.map((plan) =>
    planReuse(plan, previous, CURR_MEASUREMENTS, buildHistory(plan)),
  )
  return {
    metric: REUSE_PLANS[0].metric,
    window: REUSE_PLANS[0].window,
    plans: REUSE_PLANS,
    commonPopulation: COMMON_POPULATION,
    recalculatedPopulation: reports[0]?.recalculatedPopulation ?? 0,
    reusedPopulation: reports[0]?.reusedPopulation ?? 0,
    reusedBatch: reports[0]?.reusedBatch || PREV_BATCH,
    reports,
    snapshots: REUSE_PLANS.map((plan, index) =>
      nextSnapshot(buildInitialSnapshot(plan), reports[index], CURR_BATCH),
    ),
    checkRecords: [],
  }
}
