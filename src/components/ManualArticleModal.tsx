'use client'

import { useState } from 'react'
import { Article } from '@/types'

interface Result {
  url: string
  status: 'ok' | 'error' | 'processing'
  error?: string
  article?: Article
}

interface Props {
  runId: string
  onAdded: (articles: Article[]) => void
  onClose: () => void
}

export default function ManualArticleModal({ runId, onAdded, onClose }: Props) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [processing, setProcessing] = useState(false)
  const [forceCategory, setForceCategory] = useState<string>('')

  function parseUrls(raw: string): string[] {
    return raw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.startsWith('http'))
  }

  const urls = parseUrls(text)

  async function handleSubmit() {
    if (!urls.length) return
    setProcessing(true)

    // 초기 상태: processing
    setResults(urls.map(url => ({ url, status: 'processing' })))

    const res = await fetch(`/api/run/${runId}/manual-articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, forceCategory: forceCategory || undefined }),
    })
    const data = await res.json()

    const apiResults: Result[] = data.results ?? []
    setResults(apiResults)
    setProcessing(false)

    const added = apiResults
      .filter(r => r.status === 'ok' && r.article)
      .map(r => r.article as Article)

    if (added.length > 0) onAdded(added)
  }

  const doneCount = results.filter(r => r.status === 'ok').length
  const failCount = results.filter(r => r.status === 'error').length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800">기사 수동 추가</h2>
            <p className="text-xs text-gray-400 mt-0.5">링크를 붙여넣으면 AI가 요약·번역·분류해서 추가합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* 입력 */}
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

        {/* 진행 결과 */}
        {results.length > 0 && (
          <div className="px-5 pb-2 flex-1 overflow-y-auto">
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
              disabled={!urls.length || processing}
              className="px-5 py-2 text-sm font-medium bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white rounded-lg transition flex items-center gap-2"
            >
              {processing ? (
                <><span className="animate-spin inline-block">⏳</span> AI 처리 중...</>
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
