'use client'

import { useState } from 'react'
import { RunLog } from '@/types'

interface Props {
  runLog: RunLog
  isAdmin: boolean
  onUpdate: (ko: string[], zh: string[]) => Promise<void>
  onRegenerate: () => Promise<void>
}

function BulletEditor({
  lines,
  onChange,
  autoFocusFirst,
}: {
  lines: string[]
  onChange: (lines: string[]) => void
  autoFocusFirst?: boolean
}) {
  const text = lines.join('\n')

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 flex flex-col pointer-events-none" aria-hidden>
        {lines.map((_, i) => (
          <span key={i} className="text-gray-300 text-sm leading-[1.6rem]">•</span>
        ))}
      </div>
      <textarea
        autoFocus={autoFocusFirst}
        value={text}
        rows={Math.max(lines.length, 1)}
        onChange={e => onChange(e.target.value.split('\n'))}
        className="w-full border border-gray-200 rounded pl-5 pr-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#c8102e]/30 focus:border-[#c8102e] resize-none leading-[1.6rem]"
      />
    </div>
  )
}

export default function InsightPanel({ runLog, isAdmin, onUpdate, onRegenerate }: Props) {
  const [editing, setEditing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const toLines = (arr?: string[]) => (arr && arr.length > 0 ? arr : [''])
  const [koNormal, setKoNormal] = useState<string[]>(() => toLines((runLog.insight_ko ?? []).filter(s => !s.startsWith('•'))))
  const [zhNormal, setZhNormal] = useState<string[]>(() => toLines((runLog.insight_zh ?? []).filter(s => !s.startsWith('•'))))
  const [koTakeaway, setKoTakeaway] = useState<string[]>(() => toLines((runLog.insight_ko ?? []).filter(s => s.startsWith('•')).map(s => s.slice(1).trim())))
  const [zhTakeaway, setZhTakeaway] = useState<string[]>(() => toLines((runLog.insight_zh ?? []).filter(s => s.startsWith('•')).map(s => s.slice(1).trim())))

  async function save() {
    const ko = [
      ...koNormal.filter(l => l.trim()),
      ...koTakeaway.filter(l => l.trim()).map(l => `• ${l}`),
    ]
    const zh = [
      ...zhNormal.filter(l => l.trim()),
      ...zhTakeaway.filter(l => l.trim()).map(l => `• ${l}`),
    ]
    await onUpdate(ko, zh)
    setEditing(false)
  }

  async function regenerate() {
    setRegenerating(true)
    await onRegenerate()
    setRegenerating(false)
  }

  const koLines = runLog.insight_ko ?? []
  const zhLines = runLog.insight_zh ?? []
  const koNormalView = koLines.filter(s => !s.startsWith('•'))
  const zhNormalView = zhLines.filter(s => !s.startsWith('•'))
  const koTakeawayView = koLines.filter(s => s.startsWith('•')).map(s => s.slice(1).trim())
  const zhTakeawayView = zhLines.filter(s => s.startsWith('•')).map(s => s.slice(1).trim())
  const hasContent = koLines.length > 0 || zhLines.length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-5 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-[#c8102e] px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-white font-semibold text-sm tracking-wide">오늘의 하이라이트</span>
          <span className="text-red-300 text-xs">今日要点</span>
        </div>
        <div className="flex gap-1.5">
          {isAdmin && (
            <button onClick={regenerate} disabled={regenerating}
              className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded transition disabled:opacity-50">
              {regenerating ? '생성 중…' : hasContent ? '재생성' : '생성'}
            </button>
          )}
          {editing ? (
            <>
              <button onClick={save} className="text-xs bg-white text-[#c8102e] font-semibold px-3 py-1.5 rounded">저장</button>
              <button onClick={() => setEditing(false)} className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded">취소</button>
            </>
          ) : (
            <button onClick={() => {
              setKoNormal(toLines((runLog.insight_ko ?? []).filter(s => !s.startsWith('•'))))
              setZhNormal(toLines((runLog.insight_zh ?? []).filter(s => !s.startsWith('•'))))
              setKoTakeaway(toLines((runLog.insight_ko ?? []).filter(s => s.startsWith('•')).map(s => s.slice(1).trim())))
              setZhTakeaway(toLines((runLog.insight_zh ?? []).filter(s => s.startsWith('•')).map(s => s.slice(1).trim())))
              setEditing(true)
            }} className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded transition">
              편집
            </button>
          )}
        </div>
      </div>

      <div className="p-7">
        {editing ? (
          <div className="space-y-6">
            {/* 요약 문장 */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">요약</p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">한국어</p>
                  <BulletEditor lines={koNormal} onChange={setKoNormal} autoFocusFirst />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">中文</p>
                  <BulletEditor lines={zhNormal} onChange={setZhNormal} />
                </div>
              </div>
            </div>

            {/* 구분선 */}
            <div className="border-t border-gray-100" />

            {/* Key Takeaways */}
            <div>
              <p className="text-xs font-semibold text-[#c8102e] uppercase tracking-wider mb-3">Key Takeaways · 核心要点</p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">한국어</p>
                  <BulletEditor lines={koTakeaway} onChange={setKoTakeaway} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">中文</p>
                  <BulletEditor lines={zhTakeaway} onChange={setZhTakeaway} />
                </div>
              </div>
            </div>
          </div>
        ) : !hasContent ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 mb-3">오늘의 하이라이트가 없습니다</p>
            <button onClick={regenerate} disabled={regenerating}
              className="text-sm bg-[#c8102e] hover:bg-[#a00d24] text-white px-4 py-2 rounded transition disabled:opacity-50">
              {regenerating ? '생성 중…' : '생성하기'}
            </button>
          </div>
        ) : (
          <div>
            {/* 요약 문장 뷰 */}
            <div className="space-y-3 mb-5">
              {koNormalView.map((ko, i) => (
                <div key={i} className="pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="flex items-start gap-1.5">
                    <span className="text-gray-300 text-sm shrink-0 mt-0.5">•</span>
                    <p className="text-sm text-gray-800 leading-relaxed">{ko}</p>
                  </div>
                  {zhNormalView[i] && (
                    <div className="flex items-start gap-1.5 mt-1 ml-4">
                      <p className="text-sm text-gray-400 leading-relaxed">{zhNormalView[i]}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Key Takeaways 뷰 */}
            {koTakeawayView.length > 0 && (
              <>
                <div className="border-t border-gray-100 mb-4" />
                <p className="text-xs font-semibold text-[#c8102e] uppercase tracking-wider mb-3">Key Takeaways · 核心要点</p>
                <div className="space-y-2">
                  {koTakeawayView.map((ko, i) => (
                    <div key={i} className="pl-3 border-l-2 border-[#c8102e]/20">
                      <div className="flex items-start gap-1.5">
                        <span className="text-gray-300 text-sm shrink-0">•</span>
                        <p className="text-sm text-gray-800 font-medium leading-relaxed">{ko}</p>
                      </div>
                      {zhTakeawayView[i] && (
                        <p className="text-sm text-gray-400 leading-relaxed mt-0.5 ml-4">{zhTakeawayView[i]}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
