import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getConfig } from '@/lib/config'
import { collectArticles } from '@/services/collector'
import { filterArticles, summarizeAndTranslate, generateInsight } from '@/services/ai'
import { v4 as uuidv4 } from 'uuid'

// 2026년 한국 공휴일 + 대체공휴일 (YYYY-MM-DD, KST)
const HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-01-28', '2026-01-29', '2026-01-30',
  '2026-03-01', '2026-03-02',
  '2026-05-05', '2026-05-25',
  '2026-06-03',
  '2026-07-17',
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
  const dow = new Date(kstDate + 'T09:00:00+09:00').getUTCDay()
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

  await supabase.from('run_logs').update({
    status: 'collected',
    current_step: 'collected',
    total_collected: raw.length,
    raw_articles: raw,
  }).eq('id', runId)

  console.log(`[수집완료] runId=${runId}, 수집=${raw.length}건 → AI 처리 시작`)

  // 수집 완료 후 자동으로 AI 처리 파이프라인 실행
  await processPipeline(runId, supabase, raw, config)
}

async function processPipeline(
  runId: string,
  supabase: ReturnType<typeof createServiceClient>,
  raw: Awaited<ReturnType<typeof collectArticles>>,
  config: Awaited<ReturnType<typeof getConfig>>
) {
  const setStep = (step: string) =>
    supabase.from('run_logs').update({ current_step: step, status: 'running' }).eq('id', runId)

  // AI 필터링
  await setStep('filtering')
  const filtered = await filterArticles(raw, config.media_tiers)

  // 정렬 + 선택
  await setStep('selecting')
  const impactOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  const sorted = filtered.sort((a, b) => {
    const impactDiff = (impactOrder[a.impactLevel] ?? 2) - (impactOrder[b.impactLevel] ?? 2)
    if (impactDiff !== 0) return impactDiff
    if (a.mediaTier !== b.mediaTier) return a.mediaTier - b.mediaTier
    return b.relevanceScore - a.relevanceScore
  })

  const MIN_TOTAL = 15
  const MAX_TOTAL = 30
  const selected: typeof filtered = []
  const catCount: Record<string, number> = {}
  const maxPerCat: Record<string, number> = { '자사': 10, '업계': 10, '정책': 10, '위기이슈': 10 }

  for (const article of sorted) {
    if (selected.length >= MAX_TOTAL) break
    const cat = article.finalCategory
    if ((catCount[cat] ?? 0) >= (maxPerCat[cat] ?? 6)) continue
    selected.push(article)
    catCount[cat] = (catCount[cat] ?? 0) + 1
  }

  if (selected.length < MIN_TOTAL) {
    for (const article of sorted) {
      if (selected.length >= MAX_TOTAL) break
      if (selected.includes(article)) continue
      selected.push(article)
    }
  }

  // 요약 + 번역
  await setStep('summarizing')
  const processed = await summarizeAndTranslate(selected)

  // DB 저장 (최종 중복 제거)
  await setStep('saving')
  const seenTitles = new Set<string>()
  const dedupedProcessed = processed.filter(a => {
    const key = (a.title ?? '').replace(/[\s\W]/g, '').toLowerCase()
    if (seenTitles.has(key)) return false
    seenTitles.add(key)
    return true
  })

  const articles = dedupedProcessed.map((a, i) => ({
    id: uuidv4(),
    run_id: runId,
    order_index: i,
    excluded: false,
    collected_at: new Date().toISOString(),
    tag: a.tag ?? null,
    impact_level: a.impact_level ?? 'MEDIUM',
    why_it_matters_ko: a.why_it_matters_ko ?? null,
    why_it_matters_zh: a.why_it_matters_zh ?? null,
    ...a,
  }))

  if (articles.length > 0) {
    const { error } = await supabase.from('articles').insert(articles)
    if (error) throw new Error(`기사 저장 실패: ${error.message}`)
  }

  // Executive Brief
  await setStep('briefing')
  const insight = await generateInsight(dedupedProcessed)

  await supabase.from('run_logs').update({
    status: 'completed',
    current_step: 'completed',
    total_after_filter: dedupedProcessed.length,
    insight_ko: insight.ko,
    insight_zh: insight.zh,
    key_takeaways: insight.keyTakeaways,
    emerging_signals: insight.emergingSignals,
    tomorrow_watchlist: insight.tomorrowWatchlist,
    insight_generated_at: new Date().toISOString(),
    recipients: config.recipients,
    draft_saved_at: new Date().toISOString(),
    raw_articles: null,
  }).eq('id', runId)

  console.log(`[처리완료] runId=${runId}, 선택=${dedupedProcessed.length}건`)
}
