import { useCallback, useEffect, useMemo, useState } from 'react'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  loadReuseOverview,
  resetReuseData,
  runReuseUpdate,
  simulateConcurrentCommit,
} from '@/api/benchmark-service'
import type { ConcurrentCommitDemo, ReuseOverview } from '@/api/benchmark-service'
import { formatInterval } from '@/data/baseline-reuse'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('benchmark')
const columns = [
  "方案编号",
  "对标对象",
  "对比指标",
  "数据来源",
  "基准值",
  "目标值",
  "采集周期",
  "差距阈值"
]
const actions = [
  "提交方案评审",
  "启用方案",
  "冻结方案"
]
const statuses = [
  "草稿",
  "方案评审中",
  "已启用",
  "已冻结"
]

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

function formatGap(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}pp`
}

function formatPopulation(value: number): string {
  return value.toLocaleString('zh-CN')
}

export default function BenchmarkView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [reuse, setReuse] = useState<ReuseOverview | null>(null)
  const [concurrency, setConcurrency] = useState<ConcurrentCommitDemo | null>(null)
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
      setReuse(loadReuseOverview())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '竞品对标列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    reload()
  }

  function handleReuseUpdate() {
    setReuse(runReuseUpdate())
    setConcurrency(null)
  }

  function handleConcurrentDemo() {
    setConcurrency(simulateConcurrentCommit())
    setReuse(loadReuseOverview())
  }

  function handleResetReuse() {
    resetReuseData()
    setConcurrency(null)
    setReuse(loadReuseOverview())
  }

  const stats = [
    { label: '重合判定粒度', value: '画像分层区间（10% 一档）' },
    { label: '共同人群', value: reuse ? `${formatPopulation(reuse.commonPopulation)} 人` : '—' },
    { label: '本次重算', value: reuse ? `${formatPopulation(reuse.recalculatedPopulation)} 人` : '—' },
    { label: '沿用历史', value: reuse ? `${formatPopulation(reuse.reusedPopulation)} 人` : '—' },
  ]

  const latestCheck = reuse?.checkRecords[0] ?? null

  return (
    <section className="page" data-module="benchmark">
      <header className="page-head">
        <div>
          <h2>竞品对标管理</h2>
          <p className="page-desc">定义竞品或行业对标分析方案，追踪关键指标的差距和趋势变化。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('对标方案登记入口尚未接入审批流')}>
            登记对标方案
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出竞品对标清单
          </button>
        </div>
      </header>

      <section className="panel" data-panel="baseline-reuse">
        <header className="panel-head">
          <div>
            <h3>重合群组基准复用</h3>
            <p className="page-desc">
              按对比指标、基准值和观察窗口复用相同基准；只重算差值发生变化的分层人群，
              未变化的留存方案继续沿用自己的历史结果。
            </p>
          </div>
          <div className="page-actions">
            <button className="btn primary" type="button" onClick={handleReuseUpdate}>
              执行对标更新
            </button>
            <button className="btn" type="button" onClick={handleConcurrentDemo}>
              模拟并发提交
            </button>
            <button className="btn ghost" type="button" onClick={handleResetReuse}>
              重置复用数据
            </button>
          </div>
        </header>

        <div className="stat-row">
          {stats.map((item) => (
            <article key={item.label} className="stat-card">
              <span className="stat-label">{item.label}</span>
              <strong className="stat-value">{item.value}</strong>
            </article>
          ))}
        </div>

        {reuse && (
          <>
            <p className="status-legend">
              {reuse.plans.map((plan) => (
                <span key={plan.planCode} className="legend-item">
                  {plan.planCode} 基准 {formatPercent(plan.baselineValue)}
                </span>
              ))}
              <span className="legend-item">对比指标：{reuse.metric}</span>
              <span className="legend-item">观察窗口：{reuse.window}</span>
              <span className="legend-item">沿用批次：{reuse.reusedBatch}</span>
            </p>

            {latestCheck && (
              <div className="check-record">
                <strong>重合核对记录（最新）</strong>
                <span>
                  {latestCheck.plans.map((plan) => `${plan.planCode} 基准 ${formatPercent(plan.baselineValue)}`).join('、')}
                  ；共同人群 {formatPopulation(latestCheck.commonPopulation)} 人
                </span>
                <span>
                  只重算落在 {latestCheck.recalculatedIntervals.join('、') || '—'} 留存区间内的{' '}
                  {formatPopulation(latestCheck.recalculatedPopulation)} 人，其他对标结论沿用{' '}
                  {latestCheck.reusedBatch}
                </span>
              </div>
            )}

            <table className="data-table">
              <thead>
                <tr>
                  <th>留存区间</th>
                  <th>重合人群</th>
                  <th>上期实测</th>
                  <th>本期实测</th>
                  <th>差值变化</th>
                  <th>处置</th>
                  {reuse.plans.map((plan) => (
                    <th key={plan.planCode}>{plan.planCode} 留存差距</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reuse.reports[0]?.decisions.map((decision) => {
                  const intervalText = formatInterval(decision.interval)
                  return (
                    <tr key={intervalText}>
                      <td>{intervalText}</td>
                      <td>{formatPopulation(decision.population)}</td>
                      <td>{formatPercent(decision.previousActual)}</td>
                      <td>{formatPercent(decision.currentActual)}</td>
                      <td>{decision.drift.toFixed(2)}pp</td>
                      <td>
                        <span className={decision.recalculate ? 'badge warn' : 'badge ok'}>
                          {decision.recalculate ? '重算' : `沿用 ${reuse.reusedBatch}`}
                        </span>
                      </td>
                      {reuse.reports.map((report) => {
                        const conclusion = report.conclusions.find(
                          (item) => formatInterval(item.interval) === intervalText,
                        )
                        return (
                          <td key={report.planCode}>
                            {conclusion ? formatGap(conclusion.gap) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {concurrency && (
              <div className="check-record">
                <strong>并发提交结果（同一基准 {concurrency.baselineKey}）</strong>
                <span>
                  {concurrency.first.taskId}：
                  <span className={concurrency.first.ok ? 'badge ok' : 'badge conflict'}>
                    {concurrency.first.ok ? '已提交' : '失败'}
                  </span>
                  {concurrency.first.message}
                </span>
                <span>
                  {concurrency.second.taskId}：
                  <span className={concurrency.second.ok ? 'badge ok' : 'badge conflict'}>
                    {concurrency.second.ok ? '已提交' : '冲突'}
                  </span>
                  {concurrency.second.message}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无竞品对标数据，可先登记对标方案</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条竞品对标记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
