import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getConfig } from '@/lib/config'
import { collectArticles } from '@/services/collector'
import { filterArticles, summarizeAndTranslate, generateInsight } from '@/services/ai'
import { v4 as uuidv4 } from 'uuid'

// 2026년 한국 공휴일 + 대체공휴일 (YYYY-MM-DD, KST)
const HOLIDAYS_2026 = new Set([
  '2026-01-01', // 신정
  '2026-01-28', '2026-01-29', '2026-01-30', // 설날 연휴
  '2026-03-01', // 삼일절
  '2026-03-02', // 삼일절 대체공휴일
  '2026-05-05', // 어린이날
  '2026-05-25', // 부처님오신날
  '2026-06-03', // 전국동시지방선거
  '2026-08-15', // 광복절
  '2026-09-24', '2026-09-25', '2026-09-26', // 추석 연휴
  '2026-10-03', // 개천절
  '2026-10-09', // 한글날
  '2026-12-25', // 크리스마스
])

function getKstDateStr(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function isNonWorkingDay(date: Date): boolean {
  const kstDate = getKstDateStr(date)
  if (HOLIDAYS_2026.has(kstDate)) return true
  const dow = new Date(kstDate + 'T00:00:00+09:00').getDay()
  return dow === 0 || dow === 6  // 일요일=0, 토요일=6
}

// 오늘 포함 직전 연속 비근무일 수 계산 → 수집 기간 확장에 사용
function countPrecedingNonWorkingDays(): number {
  let count = 0
  const d = new Date()
  d.setDate(d.getDate() - 1)  // 어제부터 역산
  while (isNonWorkingDay(d)) {
    count++
    d.setDate(d.getDate() - 1)
    if (count > 7) break  // 최대 1주일
  }
  return count
}

export async function GET() {
  const today = new Date()
  if (isNonWorkingDay(today)) {
    return NextResponse.json({
      message: '주말/공휴일 — 메인 브리핑 생략',
      date: getKstDateStr(today),
    })
  }

  // 연휴 다음 첫 근무일이면 수집 기간 확장 (기본 24h + 비근무일 수 × 24h)
  const extraDays = countPrecedingNonWorkingDays()
  const res = await POST(undefined, undefined, extraDays)
  return res
}

export async function POST(_req?: Request, _ctx?: unknown, extraDays = 0) {
  const supabase = createServiceClient()
  const runId = uuidv4()

  const { error: logError } = await supabase.from('run_logs').insert({
    id: runId,
    run_at: new Date().toISOString(),
    run_by: 'user',
    status: 'running',
    total_collected: 0,
    total_after_filter: 0,
    insight_ko: [],
    insight_zh: [],
    key_takeaways: [],
    emerging_signals: null,
    tomorrow_watchlist: [],
    recipients: [],
  })

  if (logError) {
    return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 })
  }

  runPipeline(runId, supabase, (_ctx as any)?.extraDays ?? extraDays).catch(async (err) => {
    console.error('파이프라인 오류:', err)
    await supabase.from('run_logs').update({
      status: 'failed',
      error: String(err),
    }).eq('id', runId)
  })

  return NextResponse.json({ runId })
}

const MIN_TOTAL = 15
const MAX_TOTAL = 20
const CATEGORIES = ['자사', '업계', '정책']

async function runPipeline(runId: string, supabase: ReturnType<typeof createServiceClient>, extraDays = 0) {
  const setStep = (step: string) => supabase.from('run_logs').update({ current_step: step }).eq('id', runId)
  const config = await getConfig()

  // 1. 수집 (연휴 다음날이면 수집 기간 확장)
  await setStep('collecting')
  const collectionHours = (config.collection_hours ?? 24) + extraDays * 24
  const raw = await collectArticles(config.keywords, collectionHours)

  // 2. AI 필터링 + 카테고리 분류 + 태그/영향도
  await setStep('filtering')
  const filtered = await filterArticles(raw, config.media_tiers)

  // 3. 영향도 HIGH → Tier → 관련성 순으로 정렬 후 총 15~20건 선택
  // 단, 카테고리 편중 방지: 한 카테고리가 전체의 60% 초과하지 않도록
  await setStep('selecting')
  const impactOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  const sorted = filtered.sort((a, b) => {
    const impactDiff = impactOrder[a.impactLevel] - impactOrder[b.impactLevel]
    if (impactDiff !== 0) return impactDiff
    if (a.mediaTier !== b.mediaTier) return a.mediaTier - b.mediaTier
    return b.relevanceScore - a.relevanceScore
  })

  const selected: typeof filtered = []
  const catCount: Record<string, number> = {}
  const maxPerCat = Math.ceil(MAX_TOTAL * 0.6)  // 한 카테고리 최대 60%

  for (const article of sorted) {
    if (selected.length >= MAX_TOTAL) break
    const cat = article.finalCategory
    if ((catCount[cat] ?? 0) >= maxPerCat) continue
    selected.push(article)
    catCount[cat] = (catCount[cat] ?? 0) + 1
  }

  // 부족하면 제한 없이 채움
  if (selected.length < MIN_TOTAL) {
    for (const article of sorted) {
      if (selected.length >= MAX_TOTAL) break
      if (selected.includes(article)) continue
      selected.push(article)
    }
  }

  // 4. 요약 + 번역 + Why It Matters
  await setStep('summarizing')
  const processed = await summarizeAndTranslate(selected)

  // 5. DB 저장
  await setStep('saving')
  const articles = processed.map((a, i) => ({
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

  // 6. Executive Brief 생성
  await setStep('briefing')
  const insight = await generateInsight(processed)
  const { error: updateErr } = await supabase.from('run_logs').update({
    status: 'completed',
    total_collected: raw.length,
    total_after_filter: selected.length,
    insight_ko: insight.ko,
    insight_zh: insight.zh,
    key_takeaways: insight.keyTakeaways,
    emerging_signals: insight.emergingSignals,
    tomorrow_watchlist: insight.tomorrowWatchlist,
    insight_generated_at: new Date().toISOString(),
    recipients: config.recipients,
    draft_saved_at: new Date().toISOString(),
  }).eq('id', runId)
  if (updateErr) console.error('[runPipeline] DB 업데이트 실패:', updateErr.message)
}
