'use client'

import { useState } from 'react'
import { Article, ArticleTag, displayIndustryTag, formatMediaName } from '@/types'

interface Props {
  article: Article
  isAdmin: boolean
  isFirst: boolean
  isLast: boolean
  mediaDisplay?: Record<string, string>
  onMoveUp: () => void
  onMoveDown: () => void
  onUpdateSummary: (id: string, field: 'summary_ko' | 'summary_zh', value: string[]) => void
  onUpdateField: (id: string, field: 'title' | 'title_zh' | 'why_it_matters_ko' | 'why_it_matters_zh', value: string) => void
  onUpdateImageUrl: (id: string, imageUrl: string) => void
  onUpdateCategory: (id: string, category: string) => void
  onUpdateTag: (id: string, tag: ArticleTag) => void
  onUpdateMedia: (id: string, media: string) => void
  onDelete: (id: string) => void
}

function BulletEditor({ lines, onChange, autoFocusFirst }: {
  lines: string[]
  onChange: (lines: string[]) => void
  autoFocusFirst?: boolean
}) {
  const text = lines.join('\n')

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 flex flex-col gap-0 pointer-events-none" aria-hidden>
        {lines.map((_, i) => (
          <span key={i} className="text-gray-300 text-sm leading-[1.6rem]">•</span>
        ))}
      </div>
      <textarea
        autoFocus={autoFocusFirst}
        value={text}
        rows={Math.max(lines.length, 1)}
        onChange={e => {
          const next = e.target.value.split('\n')
          onChange(next)
        }}
        className="w-full border border-blue-300 rounded pl-5 pr-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none leading-[1.6rem]"
      />
    </div>
  )
}

export default function ArticleCard({
  article, isAdmin, isFirst, isLast, mediaDisplay,
  onMoveUp, onMoveDown, onUpdateSummary, onUpdateField, onUpdateImageUrl, onUpdateCategory, onUpdateTag, onUpdateMedia, onDelete,
}: Props) {
  const [editing, setEditing] = useState<'ko' | 'zh' | 'title_ko' | 'title_zh' | 'wim_ko' | 'wim_zh' | null>(null)
  const [editingMedia, setEditingMedia] = useState(false)
  const [mediaInput, setMediaInput] = useState(article.media)
  const [koLines, setKoLines] = useState<string[]>(article.summary_ko.length > 0 ? article.summary_ko : [''])
  const [zhLines, setZhLines] = useState<string[]>(article.summary_zh.length > 0 ? article.summary_zh : [''])
  const [titleKo, setTitleKo] = useState(article.title)
  const [titleZh, setTitleZh] = useState(article.title_zh ?? '')
  const [wimKo, setWimKo] = useState(article.why_it_matters_ko ?? '')
  const [wimZh, setWimZh] = useState(article.why_it_matters_zh ?? '')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  function saveEdit(field: 'ko' | 'zh') {
    const lines = (field === 'ko' ? koLines : zhLines).filter(l => l.trim())
    onUpdateSummary(article.id, field === 'ko' ? 'summary_ko' : 'summary_zh', lines)
    setEditing(null)
  }

  function saveField(field: 'title_ko' | 'title_zh' | 'wim_ko' | 'wim_zh') {
    const map = { title_ko: titleKo, title_zh: titleZh, wim_ko: wimKo, wim_zh: wimZh }
    const apiField = field === 'title_ko' ? 'title' : field === 'wim_ko' ? 'why_it_matters_ko' : field === 'wim_zh' ? 'why_it_matters_zh' : 'title_zh'
    onUpdateField(article.id, apiField as 'title' | 'title_zh' | 'why_it_matters_ko' | 'why_it_matters_zh', map[field])
    setEditing(null)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    setImageError(null)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/articles/${article.id}/image`, { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) {
      setImageError(data.error ?? '업로드 실패')
    } else {
      onUpdateImageUrl(article.id, data.image_url)
    }
    setUploadingImage(false)
    e.target.value = ''
  }

  async function regenerateSummary() {
    setRegenerating(true)
    const res = await fetch(`/api/articles/${article.id}/reprocess`, { method: 'POST' })
    if (res.ok) {
      const updated = await res.json()
      setKoLines(updated.summary_ko?.length > 0 ? updated.summary_ko : [''])
      setZhLines(updated.summary_zh?.length > 0 ? updated.summary_zh : [''])
      onUpdateSummary(article.id, 'summary_ko', updated.summary_ko ?? [])
      onUpdateSummary(article.id, 'summary_zh', updated.summary_zh ?? [])
    }
    setRegenerating(false)
  }

  async function handleImageDelete() {
    setUploadingImage(true)
    const res = await fetch(`/api/articles/${article.id}/image`, { method: 'DELETE' })
    if (res.ok) onUpdateImageUrl(article.id, '')
    setUploadingImage(false)
  }

  // 인라인 텍스트 편집 헬퍼
  function InlineText({ value, onEdit, placeholder, className = '' }: {
    value: string; onEdit: () => void; placeholder?: string; className?: string
  }) {
    return (
      <span
        onClick={onEdit}
        title="클릭하여 편집"
        className={`cursor-pointer hover:bg-yellow-50 hover:outline hover:outline-1 hover:outline-yellow-300 rounded px-0.5 transition ${className}`}
      >
        {value || <span className="text-gray-300 italic">{placeholder}</span>}
      </span>
    )
  }

  return (
    <div className="px-7 py-6">
      <div className="flex items-start gap-5">
        <div className="flex-1 min-w-0">

          {/* 태그 */}
          <div className="flex items-center gap-0 mb-2">
            {article.is_manual && (
              <span className="inline-flex items-center justify-center bg-gray-100 text-gray-400 text-xs px-2 rounded font-medium leading-none h-5 mr-2">수동 추가</span>
            )}
            {article.category === '자사' && article.sentiment === 'negative' && (
              <span className="inline-flex items-center justify-center bg-amber-100 text-amber-700 text-xs px-2 rounded font-semibold leading-none h-5 mr-2">⚠️ 부정</span>
            )}
            {article.impact_level === 'HIGH' && (
              <span className="inline-flex items-center justify-center bg-[#c8102e] text-white text-xs px-2.5 py-1 rounded font-semibold">{article.impact_level}</span>
            )}
            {article.impact_level === 'MEDIUM' && (
              <span className="inline-flex items-center justify-center bg-[#e07b00] text-white text-xs px-2.5 py-1 rounded font-semibold">{article.impact_level}</span>
            )}
            {article.impact_level === 'LOW' && (
              <span className="inline-flex items-center justify-center bg-gray-400 text-white text-xs px-2.5 py-1 rounded font-semibold">{article.impact_level}</span>
            )}
            {article.tag && (
              <>
                <span className="text-gray-300 text-xs mx-2">|</span>
                <span className="inline-flex items-center justify-center text-gray-400 text-xs font-medium leading-none tracking-wide uppercase">
                  {article.category === '업계' ? displayIndustryTag(article.tag) : article.tag}
                </span>
              </>
            )}
          </div>

          {/* 제목 */}
          <div className="mb-1.5">
            {editing === 'title_ko' ? (
              <div className="flex gap-2 items-start">
                <input
                  type="text"
                  value={titleKo}
                  onChange={e => setTitleKo(e.target.value)}
                  className="flex-1 border border-blue-300 rounded px-2 py-1 text-sm text-gray-800 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-300"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveField('title_ko'); if (e.key === 'Escape') setEditing(null) }}
                />
                <button onClick={() => saveField('title_ko')} className="text-xs bg-blue-600 text-white px-3 py-1 rounded shrink-0">저장</button>
                <button onClick={() => { setTitleKo(article.title); setEditing(null) }} className="text-xs text-gray-400 px-2 py-1 rounded border shrink-0">취소</button>
              </div>
            ) : (
              <div className="flex items-start gap-1.5 group/title">
                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 font-semibold hover:underline text-sm leading-snug"
                >
                  {titleKo}
                </a>
                <button
                  onClick={() => setEditing('title_ko')}
                  className="text-xs text-blue-400 opacity-0 group-hover/title:opacity-100 transition shrink-0 mt-0.5"
                >편집</button>
              </div>
            )}
          </div>

          {/* 중국어 제목 */}
          <div className="mb-1.5">
            {editing === 'title_zh' ? (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={titleZh}
                  onChange={e => setTitleZh(e.target.value)}
                  className="flex-1 border border-blue-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                  placeholder="중국어 제목"
                  autoFocus
                />
                <button onClick={() => saveField('title_zh')} className="text-xs bg-blue-600 text-white px-3 py-1 rounded">저장</button>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-400 px-2 py-1 rounded border">취소</button>
              </div>
            ) : (
              <InlineText
                value={article.title_zh ?? ''}
                onEdit={() => setEditing('title_zh')}
                placeholder="중국어 제목 (클릭하여 입력)"
                className="text-gray-500 text-xs"
              />
            )}
          </div>

          <div className="flex items-center gap-2 text-gray-400 text-xs mb-3 flex-wrap">
            <span className="flex items-center gap-1">
              {isAdmin && editingMedia ? (
                <input
                  autoFocus
                  type="text"
                  value={mediaInput}
                  onChange={e => setMediaInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      onUpdateMedia(article.id, mediaInput.trim())
                      setEditingMedia(false)
                    }
                    if (e.key === 'Escape') {
                      setMediaInput(article.media)
                      setEditingMedia(false)
                    }
                  }}
                  onBlur={() => {
                    onUpdateMedia(article.id, mediaInput.trim())
                    setEditingMedia(false)
                  }}
                  className="border border-blue-300 rounded px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300 w-36"
                />
              ) : (
                <span
                  onClick={() => isAdmin && setEditingMedia(true)}
                  title={isAdmin ? '클릭하여 매체명 수정' : undefined}
                  className={isAdmin ? 'cursor-pointer hover:text-blue-500 hover:underline transition-colors' : ''}
                >
                  {formatMediaName(article.media, mediaDisplay)}
                </span>
              )}
              {article.media_tier <= 2 && <span className="text-blue-400">T{article.media_tier}</span>}
            </span>
            <span>|</span>
            <span>{new Date(article.pub_date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <>
              <span>|</span>
              <select
                value={article.category}
                onChange={e => onUpdateCategory(article.id, e.target.value)}
                className="text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-[#c8102e]/30"
              >
                <option value="자사">자사 (华为动态)</option>
                <option value="업계">업계 (行业资讯)</option>
                <option value="정책">정책 (政策动向)</option>
                <option value="위기이슈">위기이슈 (危机事项)</option>
              </select>
              <select
                value={article.tag as string ?? ''}
                onChange={e => onUpdateTag(article.id, e.target.value as ArticleTag)}
                className="text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-[#c8102e]/30"
              >
                {article.category === '업계' ? <>
                  <option value="Network">Network</option>
                  <option value="AI Semiconductor">AI Semiconductor</option>
                  <option value="Smart Campus">Smart Campus</option>
                  <option value="Smart Hospital">Smart Hospital</option>
                  <option value="SSD">SSD</option>
                  <option value="Digital Power">Digital Power</option>
                  <option value="Smart Device">Smart Device</option>
                  <option value="IAS">IAS</option>
                </> : <>
                  <option value="AI">AI</option>
                  <option value="Cloud">Cloud</option>
                  <option value="Smartphone">Smartphone</option>
                  <option value="Policy">Policy</option>
                  <option value="US Sanctions">US Sanctions</option>
                  <option value="China">China</option>
                  <option value="Data Center">Data Center</option>
                  <option value="Investment">Investment</option>
                </>}
              </select>
            </>
          </div>

          {/* 요약 재생성 버튼 (요약 없을 때만, 관리자만) */}
          {isAdmin && article.summary_ko.length === 0 && (
            <div className="mb-2">
              <button
                onClick={regenerateSummary}
                disabled={regenerating}
                className="text-xs border border-amber-300 hover:bg-amber-50 text-amber-700 px-3 py-1 rounded transition disabled:opacity-50"
              >
                {regenerating ? '재생성 중...' : '⟳ 요약 재생성'}
              </button>
            </div>
          )}

          {/* 한국어 요약 */}
          {editing === 'ko' ? (
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1">한국어 요약</p>
              <BulletEditor lines={koLines} onChange={setKoLines} autoFocusFirst />
              <div className="flex gap-2 mt-1">
                <button onClick={() => saveEdit('ko')} className="text-xs bg-blue-600 text-white px-3 py-1 rounded">저장</button>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-500 px-3 py-1 rounded border">취소</button>
              </div>
            </div>
          ) : (
            <div className="mb-2 group">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-medium text-gray-500">한국어 요약</span>
                <button onClick={() => setEditing('ko')} className="text-xs text-blue-400">편집</button>
              </div>
              {article.summary_ko.map((s, i) => (
                <div key={i} className="flex items-start gap-1.5 mb-0.5">
                  <span className="text-gray-400 text-sm leading-snug shrink-0">•</span>
                  <p className="text-sm text-gray-700 leading-snug">{s}</p>
                </div>
              ))}
            </div>
          )}

          {/* 중국어 요약 */}
          {editing === 'zh' ? (
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1">中文 摘要</p>
              <BulletEditor lines={zhLines} onChange={setZhLines} autoFocusFirst />
              <div className="flex gap-2 mt-1">
                <button onClick={() => saveEdit('zh')} className="text-xs bg-blue-600 text-white px-3 py-1 rounded">저장</button>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-500 px-3 py-1 rounded border">취소</button>
              </div>
            </div>
          ) : (
            <div className="mb-2 group">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-medium text-gray-500">中文 摘要</span>
                <button onClick={() => setEditing('zh')} className="text-xs text-blue-400">편집</button>
              </div>
              {article.summary_zh.length > 0
                ? article.summary_zh.map((s, i) => (
                    <div key={i} className="flex items-start gap-1.5 mb-0.5">
                      <span className="text-gray-400 text-sm leading-snug shrink-0">•</span>
                      <p className="text-sm text-gray-600 leading-snug">{s}</p>
                    </div>
                  ))
                : <p className="text-xs text-gray-300 italic">중국어 요약 없음 (편집 버튼으로 입력)</p>
              }
            </div>
          )}

        </div>

        {/* 우측: 이미지 + 버튼 */}
        <div className="flex flex-col gap-2 shrink-0 items-end">

          {/* 이미지 */}
          <div className="w-28 h-20 rounded overflow-hidden bg-gray-50 border border-gray-100 relative group shrink-0">
            {article.image_url ? (
              <>
                <img src={article.image_url} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5">
                  <label className="cursor-pointer bg-white text-gray-700 text-xs px-2 py-1 rounded hover:bg-gray-100 transition">
                    변경
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
                  </label>
                  <button onClick={handleImageDelete} disabled={uploadingImage} className="bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600 transition">삭제</button>
                </div>
                {uploadingImage && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <span className="text-xs text-gray-500">처리 중...</span>
                  </div>
                )}
              </>
            ) : (
              <label className={`w-full h-full flex flex-col items-center justify-center cursor-pointer text-gray-300 hover:text-gray-400 transition ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploadingImage ? <span className="text-xs text-gray-400">업로드 중...</span> : <><span className="text-xl">+</span><span className="text-xs mt-0.5">이미지</span></>}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
              </label>
            )}
          </div>
          {imageError && <p className="text-xs text-red-500">{imageError}</p>}
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline whitespace-nowrap"
          >
            원문 보기 →
          </a>

          {/* 순서 변경 */}
          <div className="flex gap-1">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-20 disabled:cursor-not-allowed transition text-xs"
              title="위로"
            >▲</button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-20 disabled:cursor-not-allowed transition text-xs"
              title="아래로"
            >▼</button>
          </div>

          {/* 삭제 */}
          {confirmDelete ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-red-500 text-center">삭제?</span>
              <button
                onClick={() => onDelete(article.id)}
                className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 transition"
              >확인</button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded border text-gray-400 hover:bg-gray-50 transition"
              >취소</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-2 py-1 rounded border border-red-200 text-red-400 hover:bg-red-50 transition whitespace-nowrap"
            >
              삭제
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
