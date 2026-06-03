import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getConfig } from '@/lib/config'
import { collectArticles } from '@/services/collector'
import { v4 as uuidv4 } from 'uuid'

// 2026년 한국 공휴일 + 대체공휴일 (YYYY-MM-DD, KST)
const HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-01-28', '2026-01-29', '2026-01-30',
  '2026-03-01', '2026-03-02',
  '2026-05-05', '2026-05-25',
  '2026-06-03',
  '2026-08-15',
  '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-09',
  '2026-12-25',
])

function getKstDateStr(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function isNonWorkingDay(date: Date): boolean {
  const kstDate = getKstDateStr(date)
  if (HOLIDAYS_2026.has(kstDate)) return true
  const dow = new Date(kstDate + 'T00:00:00+09:00').getDay()
  return dow === 0 || dow === 6
}

function countPrecedingNonWorkingDays(): number {
  let count = 0
  const d = new Date()
  d.setDate(d.getDate() - 1)
  while (isNonWorkingDay(d)) {
    count++
    d.setDate(d.getDate() - 1)
    if (count > 7) break
  }
  return count
}

export async function GET() {
  const today = new Date()
  if (isNonWorkingDay(today)) {
    return NextResponse.json({ message: '주말/공휴일 — 메인 브리핑 생략', date: getKstDateStr(today) })
  }
  const extraDays = countPrecedingNonWorkingDays()
  return POST(undefined, undefined, extraDays)
}

export async function POST(_req?: Request | NextResponse, _ctx?: unknown, extraDays = 0) {
  // hoursBack 쿼리 파라미터 지원 (수동 실행 시 커스텀 수집 기간)
  if (_req && 'url' in _req) {
    const url = new URL((_req as Request).url)
    const customHours = url.searchParams.get('hoursBack')
    if (customHours) extraDays = Math.max(0, Math.ceil((Number(customHours) - 24) / 24))
  }
  const supabase = createServiceClient()
  const runId = uuidv4()

  const { error: logError } = await supabase.from('run_logs').insert({
    id: runId,
    run_at: new Date().toISOString(),
    run_by: 'user',
    status: 'running',
    current_step: 'collecting',
    total_collected: 0,
    total_after_filter: 0,
    insight_ko: [],
    insight_zh: [],
    key_takeaways: [],
    emerging_signals: null,
    tomorrow_watchlist: [],
    recipients: [],
  })

  if (logError) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 })

  // 응답 후에도 계속 실행되도록 after() 사용
  after(async () => {
    try {
      await collectAndSave(runId, supabase, (_ctx as any)?.extraDays ?? extraDays)
    } catch (err) {
      console.error('수집 오류:', err)
      await supabase.from('run_logs').update({ status: 'failed' }).eq('id', runId)
    }
  })

  return NextResponse.json({ runId })
}

async function collectAndSave(runId: string, supabase: ReturnType<typeof createServiceClient>, extraDays = 0) {
  const config = await getConfig()
  const collectionHours = (config.collection_hours ?? 24) + extraDays * 24

  const raw = await collectArticles(config.keywords, collectionHours)

  // 수집 완료 → status를 'collected'로 변경, 2단계 트리거 대기
  await supabase.from('run_logs').update({
    status: 'collected',
    current_step: 'collected',
    total_collected: raw.length,
  }).eq('id', runId)

  // raw 기사를 임시로 DB에 저장 (run_logs.raw_articles)
  await supabase.from('run_logs').update({
    raw_articles: raw,
  }).eq('id', runId)

  console.log(`[수집완료] runId=${runId}, 수집=${raw.length}건`)
}
