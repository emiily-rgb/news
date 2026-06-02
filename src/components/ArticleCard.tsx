'use client'

import { useState } from 'react'
import { Article } from '@/types'

interface Props {
  article: Article
  isAdmin: boolean
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onUpdateSummary: (id: string, field: 'summary_ko' | 'summary_zh', value: string[]) => void
  onUpdateField: (id: string, field: 'title_zh' | 'why_it_matters_ko' | 'why_it_matters_zh', value: string) => void
  onUpdateImageUrl: (id: string, imageUrl: string) => void
  onUpdateCategory: (id: string, category: string) => void
  onDelete: (id: string) => void
}

export default function ArticleCard({
  article, isAdmin, isFirst, isLast,
  onMoveUp, onMoveDown, onUpdateSummary, onUpdateField, onUpdateImageUrl, onUpdateCategory, onDelete,
}: Props) {
  const [editing, setEditing] = useState<'ko' | 'zh' | 'title_zh' | 'wim_ko' | 'wim_zh' | null>(null)
  const [koText, setKoText] = useState(article.summary_ko.join('\n'))
  const [zhText, setZhText] = useState(article.summary_zh.join('\n'))
  const [titleZh, setTitleZh] = useState(article.title_zh ?? '')
  const [wimKo, setWimKo] = useState(article.why_it_matters_ko ?? '')
  const [wimZh, setWimZh] = useState(article.why_it_matters_zh ?? '')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function saveEdit(field: 'ko' | 'zh') {
    const text = field === 'ko' ? koText : zhText
    const lines = text.split('\n').filter(l => l.trim())
    onUpdateSummary(article.id, field === 'ko' ? 'summary_ko' : 'summary_zh', lines)
    setEditing(null)
  }

  function saveField(field: 'title_zh' | 'wim_ko' | 'wim_zh') {
    const map = { title_zh: titleZh, wim_ko: wimKo, wim_zh: wimZh }
    const apiField = field === 'wim_ko' ? 'why_it_matters_ko' : field === 'wim_zh' ? 'why_it_matters_zh' : 'title_zh'
    onUpdateField(article.id, apiField as 'title_zh' | 'why_it_matters_ko' | 'why_it_matters_zh', map[field])
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
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">

          {/* 태그 + 제목 */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {article.category === '자사' && article.sentiment === 'negative' && (
              <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">⚠️ 부정</span>
            )}
            {article.category === '자사' && article.impact_level === 'HIGH' && (
              <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-medium">HIGH</span>
            )}
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 font-semibold hover:underline text-sm leading-snug"
            >
              {article.title}
            </a>
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
            <span>
              {article.media}
              {article.media_tier <= 2 && <span className="ml-1 text-blue-400">T{article.media_tier}</span>}
            </span>
            <span>|</span>
            <span>{new Date(article.pub_date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            {isAdmin && (
              <>
                <span>|</span>
                <select
                  value={article.category}
                  onChange={e => onUpdateCategory(article.id, e.target.value)}
                  className="text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-[#c8102e]/30"
                >
                  <option value="자사">자사</option>
                  <option value="업계">업계</option>
                  <option value="정책">정책</option>
                </select>
              </>
            )}
          </div>

          {/* 이미지 */}
          <div className="mb-3">
            {article.image_url ? (
              <div className="relative inline-block group">
                <img src={article.image_url} alt="" className="h-28 object-cover rounded border border-gray-100" />
                {/* 호버 시 변경/삭제 오버레이 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition rounded flex items-center justify-center gap-2">
                  <label className="cursor-pointer bg-white text-gray-700 text-xs px-2 py-1 rounded hover:bg-gray-100 transition">
                    변경
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
                  </label>
                  <button
                    onClick={handleImageDelete}
                    disabled={uploadingImage}
                    className="bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600 transition"
                  >삭제</button>
                </div>
                {uploadingImage && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded">
                    <span className="text-xs text-gray-500">처리 중...</span>
                  </div>
                )}
              </div>
            ) : (
              <label className={`inline-flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 hover:text-blue-500 transition ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploadingImage ? (
                  <span className="text-gray-400">업로드 중...</span>
                ) : (
                  <>
                    <span className="text-base leading-none">🖼</span>
                    <span>이미지 추가</span>
                  </>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
              </label>
            )}
            {imageError && <p className="text-xs text-red-500 mt-1">{imageError}</p>}
          </div>

          {/* 한국어 요약 */}
          {editing === 'ko' ? (
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1">한국어 요약</p>
              <textarea
                value={koText}
                onChange={e => setKoText(e.target.value)}
                className="w-full border border-blue-300 rounded p-2 text-sm text-gray-700 resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2 mt-1">
                <button onClick={() => saveEdit('ko')} className="text-xs bg-blue-600 text-white px-3 py-1 rounded">저장</button>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-500 px-3 py-1 rounded border">취소</button>
              </div>
            </div>
          ) : (
            <div className="mb-2 group">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-medium text-gray-500">한국어 요약</span>
                <button onClick={() => setEditing('ko')} className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition">편집</button>
              </div>
              {article.summary_ko.map((s, i) => (
                <p key={i} className="text-sm text-gray-700 mb-0.5">{s}</p>
              ))}
            </div>
          )}

          {/* 중국어 요약 */}
          {editing === 'zh' ? (
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1">中文 摘要</p>
              <textarea
                value={zhText}
                onChange={e => setZhText(e.target.value)}
                className="w-full border border-blue-300 rounded p-2 text-sm text-gray-700 resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2 mt-1">
                <button onClick={() => saveEdit('zh')} className="text-xs bg-blue-600 text-white px-3 py-1 rounded">저장</button>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-500 px-3 py-1 rounded border">취소</button>
              </div>
            </div>
          ) : (
            <div className="mb-2 group">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-medium text-gray-500">中文 摘要</span>
                <button onClick={() => setEditing('zh')} className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition">편집</button>
              </div>
              {article.summary_zh.length > 0
                ? article.summary_zh.map((s, i) => <p key={i} className="text-sm text-gray-600 mb-0.5">{s}</p>)
                : <p className="text-xs text-gray-300 italic">중국어 요약 없음 (편집 버튼으로 입력)</p>
              }
            </div>
          )}

        </div>

        {/* 우측 버튼 */}
        <div className="flex flex-col gap-2 shrink-0 items-end">
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
