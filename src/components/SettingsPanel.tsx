'use client'

import { useState, useEffect } from 'react'
import { Config, DEFAULT_CONFIG } from '@/types'

interface Props {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: Props) {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [newRecipient, setNewRecipient] = useState('')
  const [senderInfo, setSenderInfo] = useState<{ name: string; address: string } | null>(null)

  useEffect(() => {
    fetch('/api/sender-info').then(r => r.json()).then(setSenderInfo).catch(() => null)
  }, [])

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig)
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    setSaving(false)
    onClose()
  }

  function addRecipient() {
    if (!newRecipient.trim()) return
    setConfig(c => ({ ...c, recipients: [...c.recipients, newRecipient.trim()] }))
    setNewRecipient('')
  }

  function removeRecipient(email: string) {
    setConfig(c => ({ ...c, recipients: c.recipients.filter(r => r !== email) }))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-gray-800 text-lg">설정</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-6">
          {/* 수집 시간 범위 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">수집 기준 시간</label>
            <select
              value={config.collection_hours}
              onChange={e => setConfig(c => ({ ...c, collection_hours: Number(e.target.value) }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40"
            >
              <option value={6}>6시간</option>
              <option value={12}>12시간</option>
              <option value={24}>24시간</option>
              <option value={48}>48시간</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">수집 실행 시점 기준으로 이 시간 내 발행된 기사만 수집</p>
          </div>

          {/* 발신자 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">발신자 이메일</label>
            {senderInfo ? (
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700">
                <span className="font-medium">{senderInfo.name}</span>
                <span className="text-gray-400 mx-2">|</span>
                <span>{senderInfo.address}</span>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
                ⚠️ 발신자 미설정 — <code className="bg-yellow-100 px-1 rounded">.env.local</code>에{' '}
                <code className="bg-yellow-100 px-1 rounded">GMAIL_USER</code>,{' '}
                <code className="bg-yellow-100 px-1 rounded">GMAIL_APP_PASSWORD</code>를 확인해주세요.
              </div>
            )}
          </div>

          {/* 수신자 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">이메일 수신자</label>
            <div className="flex gap-2 mb-2">
              <input
                type="email"
                value={newRecipient}
                onChange={e => setNewRecipient(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addRecipient()}
                placeholder="email@example.com"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1"
              />
              <button
                onClick={addRecipient}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm"
              >추가</button>
            </div>
            <div className="space-y-1.5">
              {config.recipients.map(email => (
                <div key={email} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700">{email}</span>
                  <button onClick={() => removeRecipient(email)} className="text-red-400 hover:text-red-600 text-xs">삭제</button>
                </div>
              ))}
              {config.recipients.length === 0 && (
                <p className="text-xs text-gray-400">수신자가 없습니다.</p>
              )}
            </div>
          </div>

          {/* 키워드 카테고리 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">키워드 / 카테고리</label>
            <div className="space-y-3">
              {config.keywords.map((cat, ci) => (
                <div key={ci} className="border border-gray-100 rounded-lg p-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">{cat.category}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.keywords.map((kw, ki) => (
                      <span key={ki} className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                        {kw}
                        <button
                          onClick={() => setConfig(c => ({
                            ...c,
                            keywords: c.keywords.map((cc, cii) =>
                              cii === ci ? { ...cc, keywords: cc.keywords.filter((_, kii) => kii !== ki) } : cc
                            )
                          }))}
                          className="text-gray-400 hover:text-red-500"
                        >×</button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 border-t flex justify-end gap-3">
          <button onClick={onClose} className="border border-gray-200 px-5 py-2 rounded-lg text-sm text-gray-600">취소</button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
