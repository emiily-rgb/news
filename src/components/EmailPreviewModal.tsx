'use client'

import { useState } from 'react'
import { RunLog } from '@/types'

interface Props {
  html: string
  runLog: RunLog
  recipients: string[]
  isAdmin: boolean
  onClose: () => void
  onSent?: () => void
}

export default function EmailPreviewModal({ html, runLog, recipients, isAdmin, onClose, onSent }: Props) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const d = new Date(runLog.run_at)
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const subject = `[Huawei Daily Monitoring] ${dateStr}`

  async function sendEmail() {
    if (recipients.length === 0) {
      setError('수신자가 없습니다. 설정에서 수신자를 추가해주세요.')
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: runLog.id, recipients, subject, html }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '발송 실패')
      setSent(true)
      onSent?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '발송 중 오류가 발생했습니다.')
    } finally {
      setSending(false)
    }
  }

  function copyHtml() {
    navigator.clipboard.writeText(html)
    alert('HTML이 클립보드에 복사되었습니다.')
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-bold text-gray-800">이메일 미리보기</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              수신자: {recipients.length > 0 ? recipients.join(', ') : '(미설정 — 설정에서 추가)'}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={copyHtml}
              className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded-lg text-sm transition"
            >
              HTML 복사
            </button>
            {isAdmin && (sent ? (
              <span className="bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium">
                ✓ 발송 완료
              </span>
            ) : (
              <button
                onClick={sendEmail}
                disabled={sending || recipients.length === 0}
                className="bg-[#c8102e] hover:bg-[#a00d24] disabled:bg-gray-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {sending ? <><span className="animate-spin inline-block">⏳</span> 발송 중...</> : '✉ 발송하기'}
              </button>
            ))}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 px-2 text-xl">✕</button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm">
            ⚠️ {error}
          </div>
        )}

        <div className="flex-1 overflow-auto p-2">
          <iframe
            srcDoc={html}
            className="w-full h-full min-h-[600px] border-0 rounded"
            title="이메일 미리보기"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}
