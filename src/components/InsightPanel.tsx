'use client'

import { useState } from 'react'
import { RunLog } from '@/types'

interface Props {
  runLog: RunLog
  onUpdate: (ko: string[], zh: string[]) => Promise<void>
  onRegenerate: () => Promise<void>
}

export default function InsightPanel({ runLog, onUpdate, onRegenerate }: Props) {
  const [editing, setEditing] = useState(false)
  const [koText, setKoText] = useState(runLog.insight_ko?.join('\n') ?? '')
  const [zhText, setZhText] = useState(runLog.insight_zh?.join('\n') ?? '')
  const [regenerating, setRegenerating] = useState(false)

  async function save() {
    await onUpdate(
      koText.split('\n').filter(l => l.trim()),
      zhText.split('\n').filter(l => l.trim()),
    )
    setEditing(false)
  }

  async function regenerate() {
    setRegenerating(true)
    await onRegenerate()
    setRegenerating(false)
  }

  const koLines = runLog.insight_ko ?? []
  const zhLines = runLog.insight_zh ?? []
  const maxLen = Math.max(koLines.length, zhLines.length)

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-5 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-[#c8102e] px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-white font-semibold text-sm tracking-wide">오늘의 하이라이트</span>
          <span className="text-red-300 text-xs">今日焦点新闻</span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded transition disabled:opacity-50"
          >
            {regenerating ? '재생성 중…' : '재생성'}
          </button>
          {editing ? (
            <>
              <button onClick={save} className="text-xs bg-white text-[#c8102e] font-semibold px-3 py-1.5 rounded">저장</button>
              <button onClick={() => setEditing(false)} className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded">취소</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded transition">
              편집
            </button>
          )}
        </div>
      </div>

      <div className="p-7">
        {editing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="text-xs font-medium text-gray-400 mb-2 block uppercase tracking-wider">한국어</label>
              <textarea
                value={koText}
                onChange={e => setKoText(e.target.value)}
                className="w-full border border-gray-200 rounded p-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-[#c8102e]/40 focus:border-[#c8102e]"
                rows={7}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 mb-2 block uppercase tracking-wider">中文</label>
              <textarea
                value={zhText}
                onChange={e => setZhText(e.target.value)}
                className="w-full border border-gray-200 rounded p-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-[#c8102e]/40 focus:border-[#c8102e]"
                rows={7}
              />
            </div>
          </div>
        ) : maxLen === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 mb-3">Executive Summary가 없습니다</p>
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="text-sm bg-[#c8102e] hover:bg-[#a00d24] text-white px-4 py-2 rounded transition disabled:opacity-50"
            >
              {regenerating ? '생성 중…' : '생성하기'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from({ length: maxLen }).map((_, i) => {
              const ko = koLines[i] ?? ''
              const zh = zhLines[i] ?? ''
              const isBullet = ko.startsWith('•') || ko.startsWith('-')
              return (
                <div
                  key={i}
                  className={`${isBullet
                    ? 'pl-4 border-l-2 border-[#c8102e]/25'
                    : 'pb-4 border-b border-gray-100 last:border-0 last:pb-0'
                  }`}
                >
                  {ko && (
                    <p className={`text-sm text-gray-800 leading-relaxed ${isBullet ? 'font-medium' : ''}`}>
                      {ko}
                    </p>
                  )}
                  {zh && (
                    <p className="text-sm text-gray-400 leading-relaxed mt-1">
                      {zh}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
