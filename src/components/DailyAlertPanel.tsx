'use client'

import { useState, useEffect, useCallback } from 'react'

interface DailyAlertLog {
  id: string
  slot: number
  slot_date: string
  sent_at: string | null
  recipients: string[]
  article_count: number
  status: string
}

interface DailyAlertArticle {
  id: string
  slot: number
  slot_date: string
  title: string
  link: string
  pub_date: string
  media: string
  category: string
  excluded: boolean
}

export default function DailyAlertPanel() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<DailyAlertLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  // 로그별 확장 상태
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [logArticles, setLogArticles] = useState<Record<string, DailyAlertArticle[]>>({})
  const [loadingArticles, setLoadingArticles] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})

  // 재발송
  const [resendingLog, setResendingLog] = useState<string | null>(null)
  const [resendEmail, setResendEmail] = useState<Record<string, string>>({})
  const [resendResult, setResendResult] = useState<Record<string, string>>({})
  const [sendingLog, setSendingLog] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true)
    const res = await fetch('/api/daily-alert/logs')
    const data = await res.json()
    setLogs(data.logs ?? [])
    setLoadingLogs(false)
  }, [])

  useEffect(() => {
    if (open) fetchLogs()
  }, [open, fetchLogs])

  async function toggleLog(log: DailyAlertLog) {
    const key = log.id
    if (expandedLog === key) {
      setExpandedLog(null)
      return
    }
    setExpandedLog(key)
    if (!logArticles[key]) {
      setLoadingArticles(key)
      const res = await fetch(`/api/daily-alert/articles?slot_date=${log.slot_date}&slot=${log.slot}`)
      const data = await res.json()
      const articles: DailyAlertArticle[] = data.articles ?? []
      setLogArticles(prev => ({ ...prev, [key]: articles }))
      setSelected(prev => ({ ...prev, [key]: new Set(articles.map(a => a.id)) }))
      setLoadingArticles(null)
    }
  }

  function toggleArticle(logId: string, articleId: string) {
    setSelected(prev => {
      const cur = new Set(prev[logId] ?? [])
      cur.has(articleId) ? cur.delete(articleId) : cur.add(articleId)
      return { ...prev, [logId]: cur }
    })
  }

  function toggleAll(logId: string) {
    const articles = logArticles[logId] ?? []
    const cur = selected[logId] ?? new Set()
    const allSelected = cur.size === articles.length
    setSelected(prev => ({
      ...prev,
      [logId]: allSelected ? new Set() : new Set(articles.map(a => a.id)),
    }))
  }

  async function handleResend(log: DailyAlertLog) {
    const email = resendEmail[log.id]?.trim()
    if (!email) return
    const toList = email.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    if (!toList.length) return

    setSendingLog(log.id)
    setResendResult(prev => ({ ...prev, [log.id]: '' }))

    const articleIds = [...(selected[log.id] ?? [])]

    const res = await fetch('/api/daily-alert/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot: log.slot,
        slot_date: log.slot_date,
        to: toList,
        article_ids: articleIds,
      }),
    })
    const data = await res.json()

    if (data.success) {
      setResendResult(prev => ({ ...prev, [log.id]: `✓ ${data.articleCount}건 발송 완료` }))
      setResendingLog(null)
    } else {
      setResendResult(prev => ({ ...prev, [log.id]: data.error ?? '발송 실패' }))
    }
    setSendingLog(null)
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-5">
      {/* 헤더 — 항상 표시 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition rounded-lg"
      >
        <h2 className="text-sm font-semibold text-gray-800">데일리 알림 리스트</h2>
        <span className="text-gray-400 text-xs">{open ? '▲ 접기' : '▼ 펼치기'}</span>
      </button>

      {/* 본문 */}
      {open && (
        <div className="px-6 pb-6 border-t border-gray-100">
          {loadingLogs ? (
            <p className="text-sm text-gray-400 text-center py-6">불러오는 중...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">발송 이력이 없습니다</p>
          ) : (
            <div className="space-y-2 mt-4">
              {logs.map(log => {
                const isExpanded = expandedLog === log.id
                const articles = logArticles[log.id] ?? []
                const sel = selected[log.id] ?? new Set()
                const isResending = resendingLog === log.id
                const isSending = sendingLog === log.id

                return (
                  <div key={log.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    {/* 로그 행 */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                      <button
                        onClick={() => toggleLog(log)}
                        className="flex items-center gap-3 text-left flex-1 min-w-0"
                      >
                        <span className="text-xs font-medium text-gray-500 shrink-0">
                          {log.slot_date} {log.slot}시
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">{log.article_count}건</span>
                        {log.sent_at && (
                          <span className="text-xs text-gray-400 truncate">
                            발송 {new Date(log.sent_at).toLocaleString('ko-KR', {
                              month: 'numeric', day: 'numeric',
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })}
                          </span>
                        )}
                        {log.recipients?.length > 0 && (
                          <span className="text-xs text-gray-300 truncate">
                            → {log.recipients.join(', ')}
                          </span>
                        )}
                        <span className="text-gray-300 text-xs ml-auto shrink-0">{isExpanded ? '▲' : '▼'}</span>
                      </button>
                      <button
                        onClick={() => setResendingLog(isResending ? null : log.id)}
                        className="ml-3 shrink-0 text-xs border border-gray-200 hover:bg-white px-3 py-1 rounded text-gray-600 transition"
                      >
                        재발송
                      </button>
                    </div>

                    {/* 재발송 입력 */}
                    {isResending && (
                      <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 flex items-center gap-2 flex-wrap">
                        <input
                          type="text"
                          value={resendEmail[log.id] ?? ''}
                          onChange={e => setResendEmail(prev => ({ ...prev, [log.id]: e.target.value }))}
                          placeholder="이메일 주소 (쉼표나 공백으로 여러 개 입력)"
                          className="flex-1 min-w-0 border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30"
                        />
                        <button
                          onClick={() => handleResend(log)}
                          disabled={isSending || !resendEmail[log.id]?.trim()}
                          className="shrink-0 bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white px-4 py-1.5 rounded text-sm font-medium transition"
                        >
                          {isSending ? '발송 중...' : '발송'}
                        </button>
                        {resendResult[log.id] && (
                          <span className={`text-xs w-full ${resendResult[log.id].startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                            {resendResult[log.id]}
                          </span>
                        )}
                      </div>
                    )}

                    {/* 기사 목록 */}
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        {loadingArticles === log.id ? (
                          <p className="text-xs text-gray-400 text-center py-4">불러오는 중...</p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50">
                              <button
                                onClick={() => toggleAll(log.id)}
                                className="text-xs text-[#c8102e] hover:underline"
                              >
                                {sel.size === articles.length ? '전체 해제' : '전체 선택'}
                              </button>
                              <span className="text-xs text-gray-400">{sel.size}/{articles.length}건 선택</span>
                            </div>
                            <div className="divide-y divide-gray-50">
                              {articles.map(article => (
                                <label
                                  key={article.id}
                                  className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition ${
                                    sel.has(article.id) ? 'bg-white' : 'bg-gray-50 opacity-60'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={sel.has(article.id)}
                                    onChange={() => toggleArticle(log.id, article.id)}
                                    className="mt-0.5 shrink-0 accent-[#c8102e] w-4 h-4"
                                  />
                                  <div className="min-w-0">
                                    <a
                                      href={article.link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="text-sm text-gray-800 leading-snug hover:underline"
                                    >
                                      {article.title}
                                    </a>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                      {article.media} · {new Date(article.pub_date).toLocaleString('ko-KR', {
                                        month: 'numeric', day: 'numeric',
                                        hour: '2-digit', minute: '2-digit', hour12: false,
                                      })}
                                    </p>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
