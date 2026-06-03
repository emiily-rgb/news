'use client'

import { useState, useEffect, useCallback } from 'react'
import { Article, RunLog } from '@/types'
import { buildEmailHtml } from '@/services/emailBuilder'
import ArticleCard from '@/components/ArticleCard'
import InsightPanel from '@/components/InsightPanel'
import SettingsPanel from '@/components/SettingsPanel'
import EmailPreviewModal from '@/components/EmailPreviewModal'
import ManualArticleModal from '@/components/ManualArticleModal'
import { useAuth } from '@/context/AuthContext'

function downloadCsv(articles: Article[], runLog: RunLog) {
  const d = new Date(runLog.run_at)
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const headers = ['Date', 'Category', 'Impact', 'Tag', 'Title', 'Title (ZH)', 'URL', 'Media', 'Summary (KO)', 'Summary (ZH)']
  const rows = articles
    .filter(a => !a.excluded)
    .sort((a, b) => {
      const catOrder = ['자사', '업계', '정책', '위기이슈']
      const catDiff = catOrder.indexOf(a.category) - catOrder.indexOf(b.category)
      return catDiff !== 0 ? catDiff : (a.order_index ?? 0) - (b.order_index ?? 0)
    })
    .map(a => [
      new Date(a.pub_date).toLocaleDateString('ko-KR'),
      a.category,
      a.impact_level,
      a.tag ?? '',
      a.title,
      a.title_zh ?? '',
      a.link,
      a.media,
      a.summary_ko.join(' / '),
      a.summary_zh.join(' / '),
    ])

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${date}_Huawei_News_Brief.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function initOrderIndex(arts: Article[]): Article[] {
  const cats = ['자사', '업계', '정책', '위기이슈']
  const result = arts.map(a => ({ ...a }))
  cats.forEach(cat => {
    const catItems = result.filter(a => a.category === cat)
    catItems.forEach((a, i) => { if (a.order_index == null) a.order_index = i })
  })
  return result
}

export default function Home() {
  const { profile, isAdmin, signOut, loading: authLoading } = useAuth()
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [runLog, setRunLog] = useState<RunLog | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [pastRuns, setPastRuns] = useState<Partial<RunLog>[]>([])
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null)
  const [configRecipients, setConfigRecipients] = useState<string[]>([])
  const [draftSaved, setDraftSaved] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(c => setConfigRecipients(c.recipients ?? []))
  }, [])

  useEffect(() => {
    fetch('/api/runs').then(r => r.json()).then(async (runs: Partial<RunLog>[]) => {
      setPastRuns(runs)
      const latest = runs.find(r => r.status === 'completed' && r.draft_saved_at) ?? runs.find(r => r.status === 'completed')
      if (latest?.id) {
        const res = await fetch(`/api/run/${latest.id}`)
        const data = await res.json()
        setRunId(latest.id)
        setRunLog(data.runLog)
        setArticles(initOrderIndex(data.articles ?? []))
      }
    })
  }, [])

  const pollStatus = useCallback((id: string) => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/run/${id}`)
      const data = await res.json()
      setRunLog(data.runLog)
      setCurrentStep(data.runLog?.current_step ?? null)
      setArticles(initOrderIndex(data.articles ?? []))

      const status = data.runLog?.status
      if (status === 'collected') {
        // 수집 완료 → 2단계 자동 시작
        fetch(`/api/run/${id}/process`, { method: 'POST' })
      } else if (status !== 'running') {
        clearInterval(interval)
        setPollInterval(null)
        setRunning(false)
        fetch('/api/runs').then(r => r.json()).then(setPastRuns)
      }
    }, 3000)
    setPollInterval(interval)
    return interval
  }, [])

  useEffect(() => {
    return () => { if (pollInterval) clearInterval(pollInterval) }
  }, [pollInterval])

  async function startRun() {
    setRunning(true)
    setArticles([])
    setRunLog(null)
    const res = await fetch('/api/run', { method: 'POST' })
    const { runId: id } = await res.json()
    setRunId(id)
    pollStatus(id)
  }

  async function loadRun(id: string) {
    const res = await fetch(`/api/run/${id}`)
    const data = await res.json()
    setRunId(id)
    setRunLog(data.runLog)
    setArticles(initOrderIndex(data.articles ?? []))
  }

  async function toggleExclude(article: Article) {
    const res = await fetch(`/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded: !article.excluded }),
    })
    const updated = await res.json()
    setArticles(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  async function updateSummary(id: string, field: 'summary_ko' | 'summary_zh', value: string[]) {
    const res = await fetch(`/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    const updated = await res.json()
    setArticles(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  function updateImageUrl(id: string, imageUrl: string) {
    // 업로드/삭제는 ArticleCard에서 API 직접 호출, 여기선 로컬 state만 갱신
    setArticles(prev => prev.map(a =>
      a.id === id ? { ...a, image_url: imageUrl || null } : a
    ))
  }

  async function updateField(id: string, field: 'title_zh' | 'why_it_matters_ko' | 'why_it_matters_zh', value: string) {
    const res = await fetch(`/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    const updated = await res.json()
    setArticles(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  async function updateCategory(id: string, category: string) {
    const res = await fetch(`/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    })
    const updated = await res.json()
    setArticles(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  async function deleteArticle(id: string) {
    await fetch(`/api/articles/${id}`, { method: 'DELETE' })
    setArticles(prev => prev.filter(a => a.id !== id))
  }

  async function moveArticle(id: string, direction: 'up' | 'down') {
    setArticles(prev => {
      const article = prev.find(a => a.id === id)
      if (!article) return prev

      // 같은 카테고리 내에서 정렬된 배열
      const catArticles = prev
        .filter(a => a.category === article.category)
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

      const idx = catArticles.findIndex(a => a.id === id)
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= catArticles.length) return prev

      // 배열 순서를 바꾼 뒤 0, 1, 2... 로 index 재할당
      const reordered = [...catArticles]
      ;[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]]

      const updates: Record<string, number> = {}
      reordered.forEach((a, i) => { updates[a.id] = i })

      // DB 업데이트 (변경된 두 개만)
      fetch(`/api/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_index: updates[id] }),
      })
      fetch(`/api/articles/${catArticles[swapIdx].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_index: updates[catArticles[swapIdx].id] }),
      })

      return prev.map(a => ({
        ...a,
        order_index: updates[a.id] ?? a.order_index,
      }))
    })
  }

  async function saveDraft() {
    if (!runId) return
    setSavingDraft(true)
    const res = await fetch(`/api/run/${runId}/draft`, { method: 'POST' })
    const data = await res.json()
    setDraftSaved(data.draft_saved_at)
    setSavingDraft(false)
    setRunLog(prev => prev ? { ...prev, draft_saved_at: data.draft_saved_at } : prev)
  }

  async function openPreview() {
    if (!runLog) return
    const cfg = await fetch('/api/config').then(r => r.json())
    setConfigRecipients(cfg.recipients ?? [])
    const html = buildEmailHtml(articles, runLog)
    setPreviewHtml(html)
    setShowPreview(true)
  }

  const categories = ['자사', '업계', '정책', '위기이슈'].filter(c => articles.some(a => a.category === c))
  const activeCount = articles.filter(a => !a.excluded).length

  if (authLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">로딩 중...</div>
    </div>
  }

  if (!profile) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">로딩 중...</div>
    </div>
  }

  return (
    <div className="min-h-screen bg-[#f7f7f8]">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-1 h-8 bg-[#c8102e] rounded-full" />
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">Huawei Daily News Brief</h1>
            <p className="text-xs text-gray-400">화웨이 한국법인 임직원용</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right mr-1">
            <p className="text-sm font-medium text-gray-700">{profile?.name || profile?.email}</p>
            <p className="text-xs text-gray-400">{isAdmin ? '최고 관리자' : '컨텐츠 관리자'}</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowSettings(true)} className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded text-sm transition">
              설정
            </button>
          )}
          <button onClick={signOut} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded text-sm transition">
            로그아웃
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* 뉴스 수집 카드 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">뉴스 수집</h2>
              {runLog && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(runLog.run_at).toLocaleString('ko-KR')} · 수집 {runLog.total_collected}건 → 선택 {runLog.total_after_filter}건
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {runId && (
                <button
                  onClick={() => setShowManualAdd(true)}
                  disabled={running}
                  className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded text-sm transition disabled:opacity-40"
                >
                  + 기사 직접 추가
                </button>
              )}
              <button
                onClick={startRun}
                disabled={running}
                className="bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {running ? '수집 중...' : '▶ 뉴스 수집 시작'}
              </button>
            </div>
          </div>
          {running && (
            <div className="mt-4">
              {(() => {
                const steps = [
                  { key: 'collecting',  label: 'RSS 수집' },
                  { key: 'collected',   label: '수집완료' },
                  { key: 'filtering',   label: 'AI 필터링' },
                  { key: 'selecting',   label: '기사 선택' },
                  { key: 'summarizing', label: '요약 · 번역' },
                  { key: 'saving',      label: 'DB 저장' },
                  { key: 'briefing',    label: 'Executive Brief' },
                ]
                const currentIdx = steps.findIndex(s => s.key === currentStep)
                const progress = currentIdx < 0 ? 5 : Math.round(((currentIdx + 1) / steps.length) * 100)
                return (
                  <>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-[#c8102e] rounded-full transition-all duration-700"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {steps.map((s, i) => {
                        const done = currentIdx > i
                        const active = currentIdx === i
                        return (
                          <span key={s.key} className="flex items-center gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              active ? 'bg-[#c8102e] text-white font-medium' :
                              done ? 'text-gray-400' : 'text-gray-300'
                            }`}>
                              {done ? '✓' : active ? '⟳' : ''} {s.label}
                            </span>
                            {i < steps.length - 1 && <span className="text-gray-200 text-xs">→</span>}
                          </span>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>

        {/* 최근 실행 이력 */}
        {pastRuns.length > 0 && !runLog && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">최근 실행 이력</h3>
            <div className="space-y-1.5">
              {pastRuns.slice(0, 5).map(r => (
                <button key={r.id} onClick={() => loadRun(r.id!)}
                  className="w-full text-left px-4 py-2.5 rounded bg-gray-50 hover:bg-gray-100 transition text-sm flex items-center justify-between">
                  <span className="text-gray-700">{new Date(r.run_at!).toLocaleString('ko-KR')}</span>
                  <span className="text-gray-400 text-xs">{r.total_after_filter}건</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {runLog && (
          <InsightPanel
            runLog={runLog}
            onUpdate={async (ko, zh) => {
              await fetch('/api/insight', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId, insight_ko: ko, insight_zh: zh }),
              })
              setRunLog(prev => prev ? { ...prev, insight_ko: ko, insight_zh: zh } : prev)
            }}
            onRegenerate={async () => {
              const res = await fetch('/api/insight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId }),
              })
              const data = await res.json()
              setRunLog(prev => prev ? {
                ...prev,
                insight_ko: data.ko,
                insight_zh: data.zh,
                key_takeaways: data.keyTakeaways,
                emerging_signals: data.emergingSignals,
              } : prev)
            }}
          />
        )}

        {/* 기사 카테고리별 목록 */}
        {articles.length > 0 && (
          <>
            {categories.map(cat => {
              const catArticles = articles.filter(a => a.category === cat)
              const catLabel = cat === '자사' ? '华为动态' : cat === '업계' ? '行业资讯' : cat === '정책' ? '政策动向' : '危机事项'
              return (
                <div key={cat} className="mb-5">
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <div className="w-0.5 h-4 bg-[#c8102e] rounded-full" />
                    <span className="text-sm font-bold text-gray-800">{cat}</span>
                    <span className="text-xs text-gray-400">{catLabel}</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {catArticles.filter(a => !a.excluded).length}건
                      {catArticles.some(a => a.excluded) && ` · 제외 ${catArticles.filter(a => a.excluded).length}건`}
                    </span>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                    {[...catArticles].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((article, idx, sorted) => (
                      <ArticleCard
                        key={article.id}
                        article={article}
                        isAdmin={isAdmin}
                        isFirst={idx === 0}
                        isLast={idx === sorted.length - 1}
                        onMoveUp={() => moveArticle(article.id, 'up')}
                        onMoveDown={() => moveArticle(article.id, 'down')}
                        onUpdateSummary={updateSummary}
                        onUpdateField={updateField}
                        onUpdateImageUrl={updateImageUrl}
                        onUpdateCategory={updateCategory}
                        onDelete={deleteArticle}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {/* 하단 액션 바 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-gray-600">발송 대상 <strong className="text-gray-900">{activeCount}건</strong></p>
                {(draftSaved || runLog?.draft_saved_at) && (
                  <p className="text-xs text-green-600 mt-0.5">
                    ✓ 초안 저장 {new Date(draftSaved ?? runLog!.draft_saved_at!).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={saveDraft}
                  disabled={savingDraft}
                  className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded text-sm transition disabled:opacity-50"
                >
                  {savingDraft ? '저장 중...' : '초안 저장'}
                </button>
                {runLog && (
                  <button
                    onClick={() => downloadCsv(articles, runLog)}
                    className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded text-sm transition"
                  >
                    CSV 다운로드
                  </button>
                )}
                <button onClick={openPreview}
                  className="border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded text-sm transition">
                  이메일 미리보기
                </button>
                {isAdmin && (
                  <button onClick={openPreview}
                    className="bg-[#c8102e] hover:bg-[#a00d24] text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                    발송하기
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {showSettings && isAdmin && (
        <SettingsPanel onClose={async () => {
          setShowSettings(false)
          const cfg = await fetch('/api/config').then(r => r.json())
          setConfigRecipients(cfg.recipients ?? [])
        }} />
      )}
      {showManualAdd && runId && (
        <ManualArticleModal
          runId={runId}
          onAdded={added => {
            setArticles(prev => initOrderIndex([...prev, ...added]))
            setShowManualAdd(false)
          }}
          onClose={() => setShowManualAdd(false)}
        />
      )}
      {showPreview && runLog && (
        <EmailPreviewModal
          html={previewHtml}
          runLog={runLog}
          recipients={configRecipients.length > 0 ? configRecipients : runLog.recipients}
          isAdmin={isAdmin}
          onClose={() => setShowPreview(false)}
          onSent={() => setRunLog(prev => prev ? { ...prev, sent_at: new Date().toISOString() } : prev)}
        />
      )}
    </div>
  )
}
