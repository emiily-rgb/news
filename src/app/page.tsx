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

function initOrderIndex(arts: Article[]): Article[] {
  const cats = ['자사', '업계', '정책']
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
      setArticles(initOrderIndex(data.articles ?? []))
      if (data.runLog?.status !== 'running') {
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

      // 같은 카테고리 내에서만 이동
      const catArticles = prev.filter(a => a.category === article.category).sort((a, b) => a.order_index - b.order_index)
      const idx = catArticles.findIndex(a => a.id === id)
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= catArticles.length) return prev

      const swapArticle = catArticles[swapIdx]
      const newOrderA = swapArticle.order_index
      const newOrderB = article.order_index

      // DB 업데이트 (fire and forget)
      fetch(`/api/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_index: newOrderA }),
      })
      fetch(`/api/articles/${swapArticle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_index: newOrderB }),
      })

      return prev.map(a => {
        if (a.id === id) return { ...a, order_index: newOrderA }
        if (a.id === swapArticle.id) return { ...a, order_index: newOrderB }
        return a
      })
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

  const categories = ['자사', '업계', '정책'].filter(c => articles.some(a => a.category === c))
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#c8102e] text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-xl font-bold">Huawei Executive Daily Brief</h1>
          <p className="text-red-200 text-sm mt-0.5">화웨이 한국법인 임원용 뉴스 브리핑</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">{profile?.name || profile?.email}</p>
            <p className="text-xs text-red-200">{isAdmin ? '최고 관리자' : '컨텐츠 관리자'}</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowSettings(true)} className="bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-lg text-sm transition">
              ⚙️ 설정
            </button>
          )}
          <button onClick={signOut} className="bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg text-sm transition">
            로그아웃
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-semibold text-gray-800">뉴스 수집</h2>
              {runLog && (
                <p className="text-sm text-gray-500 mt-0.5">
                  마지막 실행: {new Date(runLog.run_at).toLocaleString('ko-KR')} |
                  수집 {runLog.total_collected}건 → 선택 {runLog.total_after_filter}건
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {runId && (
                <button
                  onClick={() => setShowManualAdd(true)}
                  disabled={running}
                  className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2.5 rounded-lg font-medium text-sm transition disabled:opacity-40"
                >
                  + 기사 직접 추가
                </button>
              )}
              <button
                onClick={startRun}
                disabled={running}
                className="bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white px-6 py-2.5 rounded-lg font-medium transition flex items-center gap-2"
              >
                {running ? <><span className="animate-spin">⏳</span> 수집 중...</> : '▶ 뉴스 수집 시작'}
              </button>
            </div>
          </div>
          {running && (
            <div className="mt-4">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#c8102e] rounded-full animate-pulse w-full" />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">RSS 수집 → AI 필터링 → 요약 → 번역 → Executive Brief 생성 중…</p>
            </div>
          )}
        </div>

        {pastRuns.length > 0 && !runLog && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
            <h3 className="font-medium text-gray-700 mb-3">최근 실행 이력</h3>
            <div className="space-y-2">
              {pastRuns.slice(0, 5).map(r => (
                <button key={r.id} onClick={() => loadRun(r.id!)}
                  className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition text-sm flex items-center justify-between">
                  <span className="text-gray-700">{new Date(r.run_at!).toLocaleString('ko-KR')}</span>
                  <span className="text-gray-400">{r.total_after_filter}건</span>
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

        {articles.length > 0 && (
          <>
            {categories.map(cat => {
              const catArticles = articles.filter(a => a.category === cat)
              return (
                <div key={cat} className="mb-6">
                  <div className="bg-[#c8102e] text-white px-4 py-2.5 rounded-t-lg flex items-center justify-between">
                    <span className="font-bold">■ {cat === '자사' ? '자사 (Huawei)' : cat === '업계' ? '업계 (Industry)' : '정책 (Policy)'}</span>
                    <span className="text-red-200 text-sm">
                      {catArticles.filter(a => !a.excluded).length}건
                      {catArticles.some(a => a.excluded) && ` (제외 ${catArticles.filter(a => a.excluded).length}건)`}
                    </span>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-b-lg shadow-sm divide-y divide-gray-50">
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

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-gray-500">발송 대상: <strong className="text-gray-800">{activeCount}건</strong></p>
                {(draftSaved || runLog?.draft_saved_at) && (
                  <p className="text-xs text-green-600 mt-0.5">
                    ✓ 초안 저장됨: {new Date(draftSaved ?? runLog!.draft_saved_at!).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={saveDraft}
                  disabled={savingDraft}
                  className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-5 py-2.5 rounded-lg text-sm transition disabled:opacity-50"
                >
                  {savingDraft ? '저장 중...' : '💾 초안 저장'}
                </button>
                <button onClick={openPreview}
                  className="border border-gray-200 hover:bg-gray-50 text-gray-700 px-5 py-2.5 rounded-lg text-sm transition">
                  이메일 미리보기
                </button>
                {isAdmin && (
                  <button onClick={openPreview}
                    className="bg-[#c8102e] hover:bg-[#a00d24] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">
                    ✉ 발송하기
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
