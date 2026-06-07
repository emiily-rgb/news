'use client'

import { useState, useEffect } from 'react'
import { Article } from '@/types'

interface Result {
  url: string
  status: 'ok' | 'error' | 'processing'
  error?: string
  article?: Article
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

interface Props {
  runId: string
  onAdded: (articles: Article[]) => void
  onClose: () => void
}

type Tab = 'url' | 'collected'

function getKstYesterday() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  kst.setDate(kst.getDate() - 1)
  return kst.toLocaleDateString('en-CA')
}

function getKstToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).toLocaleDateString('en-CA')
}

export default function ManualArticleModal({ runId, onAdded, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('collected')

  // URL 탭
  const [text, setText] = useState('')
  const [forceCategory, setForceCategory] = useState<string>('')

  // 수집 기사 탭
  const [slotDate, setSlotDate] = useState(getKstYesterday())
  const [collectedArticles, setCollectedArticles] = useState<DailyAlertArticle[]>([])
  const [loadingCollected, setLoadingCollected] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [forceCategoryCollected, setForceCategoryCollected] = useState<string>('')

  // 공통
  const [results, setResults] = useState<Result[]>([])
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    if (tab !== 'collected') return
    setLoadingCollected(true)
    setSelected(new Set())
    fetch(`/api/daily-alert/articles?slot_date=${slotDate}`)
      .then(r => r.json())
      .then(data => setCollectedArticles(data.articles ?? []))
      .finally(() => setLoadingCollected(false))
  }, [tab, slotDate])

  function parseUrls(raw: string): string[] {
    return raw.split(/[\n,]+/).map(s => s.trim()).filter(s => s.startsWith('http'))
  }

  const urls = parseUrls(text)

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === collectedArticles.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(collectedArticles.map(a => a.id)))
    }
  }

  async function handleSubmit() {
    let submitUrls: string[] = []
    let category: string | undefined

    if (tab === 'url') {
      submitUrls = urls
      category = forceCategory || undefined
    } else {
      submitUrls = collectedArticles.filter(a => selected.has(a.id)).map(a => a.link)
      category = forceCategoryCollected || undefined
    }

    if (!submitUrls.length) return
    setProcessing(true)
    setResults(submitUrls.map(url => ({ url, status: 'processing' })))

    const res = await fetch(`/api/run/${runId}/manual-articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: submitUrls, forceCategory: category }),
    })
    const data = await res.json()
    const apiResults: Result[] = data.results ?? []
    setResults(apiResults)
    setProcessing(false)

    const added = apiResults.filter(r => r.status === 'ok' && r.article).map(r => r.article as Article)
    if (added.length > 0) onAdded(added)
  }

  const doneCount = results.filter(r => r.status === 'ok').length
  const failCount = results.filter(r => r.status === 'error').length
  const selectedUrls = collectedArticles.filter(a => selected.has(a.id))

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800">기사 추가</h2>
            <p className="text-xs text-gray-400 mt-0.5">AI가 요약·번역·분류해서 브리핑에 추가합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-100">
          {([['collected', '수집 기사에서 가져오기'], ['url', 'URL 직접 입력']] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setResults([]) }}
              className={`flex-1 py-2.5 text-sm font-medium transition border-b-2 ${
                tab === key
                  ? 'border-[#c8102e] text-[#c8102e]'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 탭 내용 */}
        <div className="flex-1 overflow-y-auto">

          {/* 수집 기사 탭 */}
          {tab === 'collected' && (
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-600 shrink-0">날짜</label>
                  <input
                    type="date"
                    value={slotDate}
                    onChange={e => setSlotDate(e.target.value)}
                    className="border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-700"
                  />
                  <button
                    onClick={() => setSlotDate(getKstYesterday())}
                    className={`text-xs px-2 py-1 rounded border transition ${slotDate === getKstYesterday() ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}
                  >어제</button>
                  <button
                    onClick={() => setSlotDate(getKstToday())}
                    className={`text-xs px-2 py-1 rounded border transition ${slotDate === getKstToday() ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}
                  >오늘</button>
                </div>
                <select
                  value={forceCategoryCollected}
                  onChange={e => setForceCategoryCollected(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-700 ml-auto"
                >
                  <option value="">AI 자동 분류</option>
                  <option value="자사">자사</option>
                  <option value="업계">업계</option>
                  <option value="정책">정책</option>
                  <option value="위기이슈">위기이슈</option>
                </select>
              </div>

              {loadingCollected ? (
                <p className="text-sm text-gray-400 text-center py-8">불러오는 중...</p>
              ) : collectedArticles.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">해당 날짜에 수집된 기사가 없습니다</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={toggleAll} className="text-xs text-[#c8102e] hover:underline">
                      {selected.size === collectedArticles.length ? '전체 해제' : '전체 선택'}
                    </button>
                    <span className="text-xs text-gray-400">{collectedArticles.length}건 수집됨</span>
                  </div>
                  <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                    {collectedArticles.map(article => (
                      <label
                        key={article.id}
                        className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition ${
                          selected.has(article.id) ? 'bg-red-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(article.id)}
                          onChange={() => toggleSelect(article.id)}
                          className="mt-0.5 shrink-0 accent-[#c8102e] w-4 h-4"
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 leading-snug">{article.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {article.media} · {article.category} · {new Date(article.pub_date).toLocaleString('ko-KR', {
                              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                            })} · {article.slot}시 슬롯
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* URL 직접 입력 탭 */}
          {tab === 'url' && (
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <label className="text-xs font-medium text-gray-600 shrink-0">카테고리 강제 지정</label>
                <select
                  value={forceCategory}
                  onChange={e => setForceCategory(e.target.value)}
                  disabled={processing}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] disabled:bg-gray-50"
                >
                  <option value="">AI 자동 분류</option>
                  <option value="자사">자사 (华为动态)</option>
                  <option value="업계">업계 (行业资讯)</option>
                  <option value="정책">정책 (政策动向)</option>
                  <option value="위기이슈">위기이슈 (危机事项)</option>
                </select>
              </div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                기사 URL <span className="text-gray-400 font-normal">(줄바꿈 또는 쉼표로 여러 개 입력 가능)</span>
              </label>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={processing}
                placeholder={`https://www.example.com/news/article1\nhttps://www.example.com/news/article2`}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] disabled:bg-gray-50"
                rows={5}
              />
              {urls.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">{urls.length}개 URL 인식됨</p>
              )}
            </div>
          )}

          {/* 처리 결과 */}
          {results.length > 0 && (
            <div className="px-5 pb-4">
              {(doneCount > 0 || failCount > 0) && !processing && (
                <p className="text-xs font-medium text-gray-600 mb-2">
                  ✓ {doneCount}건 추가됨
                  {failCount > 0 && <span className="text-red-500 ml-2">✗ {failCount}건 실패</span>}
                </p>
              )}
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                    r.status === 'ok' ? 'bg-green-50' :
                    r.status === 'error' ? 'bg-red-50' : 'bg-gray-50'
                  }`}>
                    <span className="mt-0.5 shrink-0">
                      {r.status === 'ok' ? '✅' : r.status === 'error' ? '❌' : '⏳'}
                    </span>
                    <div className="min-w-0">
                      {r.status === 'ok' && r.article ? (
                        <>
                          <p className="font-medium text-gray-800 truncate">{(r.article as Article).title}</p>
                          <p className="text-gray-500 mt-0.5">
                            [{(r.article as Article).category}] {(r.article as Article).tag} · {(r.article as Article).impact_level}
                          </p>
                        </>
                      ) : r.status === 'error' ? (
                        <>
                          <p className="text-gray-500 truncate">{r.url}</p>
                          <p className="text-red-500 mt-0.5">{r.error}</p>
                        </>
                      ) : (
                        <p className="text-gray-400 truncate">처리 중... {r.url}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition"
          >
            {results.some(r => r.status === 'ok') ? '닫기' : '취소'}
          </button>
          {(!results.length || failCount > 0) && (
            <button
              onClick={handleSubmit}
              disabled={processing || (tab === 'url' ? !urls.length : !selected.size)}
              className="px-5 py-2 text-sm font-medium bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white rounded-lg transition flex items-center gap-2"
            >
              {processing ? (
                <><span className="animate-spin inline-block">⏳</span> AI 처리 중...</>
              ) : tab === 'collected' ? (
                `▶ ${selected.size}건 브리핑에 추가`
              ) : (
                `▶ ${urls.length}건 추가하기`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
