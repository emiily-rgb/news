'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const err = await signIn(email, password)
    if (err) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-dvh bg-gray-50 flex items-center justify-center px-5 bg-[radial-gradient(60rem_40rem_at_15%_-10%,rgb(191_26_51/0.07),transparent_60%),radial-gradient(40rem_30rem_at_100%_110%,rgb(60_50_40/0.06),transparent_60%)]">
      <div className="bg-white rounded-2xl shadow-float w-full max-w-sm p-9">
        <div className="mb-9">
          <img src="/Huawei_Standard_logo.svg" alt="Huawei" className="h-10 mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Daily News Brief</h1>
          <p className="text-sm text-gray-500 mt-1.5">로그인이 필요합니다</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 px-3.5 py-2.5 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-300 text-white py-2.5 rounded-lg font-medium text-sm transition shadow-[0_1px_2px_rgb(191_26_51/0.3)]"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}
