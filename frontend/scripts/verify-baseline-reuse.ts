/**
 * 重合群组基准复用 —— 验收脚本（无浏览器，直接跑共用实现）。
 *
 * 用法：先 esbuild 打包再 node 执行，见 package.json 的 verify:reuse 脚本。
 *
 * 验收点：
 * 1. BENC-0001 基准 36.75%、BENC-0002 基准 41.20%，共同人群 12,840 人；
 * 2. 只重算落在 30%–40% 留存区间内的 2,316 人，其余 10,524 人沿用 10 月批次；
 * 3. 两个方案共用同一套复用判定（planReuse），差距结论各自缓存、各自沿用；
 * 4. 并发提交同一基准：先完成完整校验者胜出，后到者冲突、不覆盖。
 */
import {
  commitSnapshot,
  formatInterval,
  nextSnapshot,
  planReuse,
} from '../src/data/baseline-reuse'
import {
  COMMON_POPULATION,
  CURR_BATCH,
  CURR_MEASUREMENTS,
  PREV_BATCH,
  REUSE_PLANS,
  buildHistory,
  buildInitialSnapshot,
  previousMeasurementMap,
} from '../src/data/benchmark-reuse-seed'

let failures = 0

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  实际=${JSON.stringify(actual)}  期望=${JSON.stringify(expected)}`)
}

const previous = previousMeasurementMap()
const reports = REUSE_PLANS.map((plan) =>
  planReuse(plan, previous, CURR_MEASUREMENTS, buildHistory(plan)),
)

console.log('— 重合核对记录 —')
console.log(`BENC-0001 基准 ${REUSE_PLANS[0].baselineValue.toFixed(2)}%、BENC-0002 基准 ${REUSE_PLANS[1].baselineValue.toFixed(2)}%`)
console.log(`共同人群 ${COMMON_POPULATION.toLocaleString('zh-CN')} 人`)
console.log(`只重算 ${reports[0].recalculatedPopulation.toLocaleString('zh-CN')} 人（30%–40% 留存区间），其他对标结论沿用 ${reports[0].reusedBatch}`)
console.log('')

check('共同人群', COMMON_POPULATION, 12840)
check('BENC-0001 基准值', REUSE_PLANS[0].baselineValue, 36.75)
check('BENC-0002 基准值', REUSE_PLANS[1].baselineValue, 41.2)
check('本次重算人数', reports[0].recalculatedPopulation, 2316)
check('沿用历史人数', reports[0].reusedPopulation, 10524)
check('沿用批次', reports[0].reusedBatch, PREV_BATCH)

const recalculated = reports[0].decisions.filter((item) => item.recalculate)
check('重算分层数量', recalculated.length, 1)
check('重算分层区间', recalculated.map((item) => formatInterval(item.interval)), ['30%–40%'])

// 两个方案的判定一致（共用实现），差距结论各自按自己的基准值计算。
check(
  '两方案重算判定一致',
  reports[1].decisions.map((item) => item.recalculate),
  reports[0].decisions.map((item) => item.recalculate),
)

const changed1 = reports[0].conclusions.find((item) => item.interval.lower === 30)
const changed2 = reports[1].conclusions.find((item) => item.interval.lower === 30)
check('BENC-0001 重算后差距', changed1?.gap, 0.2)
check('BENC-0002 重算后差距', changed2?.gap, -4.25)
check('BENC-0001 重算分层批次', changed1?.batch, CURR_BATCH)
check('BENC-0002 重算分层批次', changed2?.batch, CURR_BATCH)

const reused1 = reports[0].conclusions.find((item) => item.interval.lower === 40)
const reused2 = reports[1].conclusions.find((item) => item.interval.lower === 40)
check('BENC-0001 沿用分层批次', reused1?.batch, PREV_BATCH)
check('BENC-0002 沿用分层批次', reused2?.batch, PREV_BATCH)
check('BENC-0002 沿用自己的历史基准', reused2?.baselineValue, 41.2)

// 并发：两个任务基于同一版本更新同一基准，先完成完整校验者胜出。
const snapshot = buildInitialSnapshot(REUSE_PLANS[0])
const baseVersion = snapshot.version
const first = commitSnapshot(snapshot, baseVersion, nextSnapshot(snapshot, reports[0], CURR_BATCH))
check('任务甲先完成校验并提交', first.ok, true)
const stored = first.ok ? first.snapshot : snapshot
const second = commitSnapshot(stored, baseVersion, nextSnapshot(snapshot, reports[0], CURR_BATCH))
check('任务乙后到记为冲突', second.ok, false)
check('冲突标记', !second.ok && second.conflict, true)
check('已提交版本未被覆盖', stored.version, baseVersion + 1)

console.log('')
if (failures > 0) {
  console.error(`验收未通过：${failures} 项断言失败`)
  process.exit(1)
}
console.log('验收通过：全部断言符合预期')
