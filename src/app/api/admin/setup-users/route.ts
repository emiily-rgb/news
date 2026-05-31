import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// 일회성 사용자 생성 엔드포인트 — 사용 후 삭제 가능
const USERS = [
  { email: 'davidsong31@gmail.com', password: 'Huawei2024!', role: 'admin', name: 'David Song' },
  { email: 'euny0320@gmail.com', password: 'Huawei2024!', role: 'content_manager', name: '이은영' },
]

export async function POST() {
  const supabase = createServiceClient()
  const results: Record<string, string>[] = []

  // 1) 트리거 문제 우회: profiles 테이블에 직접 upsert할 것이므로
  //    트리거가 없어도 되도록 먼저 auth 유저를 만들고 실패 시 기존 유저 조회

  for (const u of USERS) {
    let userId: string | null = null

    // 생성 시도
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    })

    if (createErr) {
      // 이미 존재하는 경우 목록에서 찾기
      const { data: list } = await supabase.auth.admin.listUsers()
      const existing = list?.users?.find(x => x.email === u.email)
      if (existing) {
        userId = existing.id
        // 비밀번호 업데이트
        await supabase.auth.admin.updateUserById(userId, { password: u.password })
        results.push({ email: u.email, status: 'updated', id: userId })
      } else {
        results.push({ email: u.email, status: 'error', error: createErr.message })
        continue
      }
    } else {
      userId = created.user?.id ?? null
      results.push({ email: u.email, status: 'created', id: userId })
    }

    if (!userId) continue

    // 2) profiles upsert
    const { error: profileErr } = await supabase.from('profiles').upsert({
      id: userId,
      email: u.email,
      role: u.role,
      name: u.name,
    }, { onConflict: 'id' })

    if (profileErr) {
      results[results.length - 1].profileError = profileErr.message
    } else {
      results[results.length - 1].profile = 'ok'
    }
  }

  return NextResponse.json({ results })
}
