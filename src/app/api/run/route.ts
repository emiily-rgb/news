import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getConfig } from '@/lib/config'
import { collectArticles } from '@/services/collector'
import { filterArticles, summarizeAndTranslate, generateInsight } from '@/services/ai'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  // Vercel cron (오전 8시 KST) 자동 실행
  const res = await POST()
  return res
}

export async function POST() {
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

  runPipeline(runId, supabase).catch(async (err) => {
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

async function runPipeline(runId: string, supabase: ReturnType<typeof createServiceClient>) {
  const config = await getConfig()

  // 1. 수집
  const raw = await collectArticles(config.keywords, config.collection_hours)

  // 2. AI 필터링 + 카테고리 분류 + 태그/영향도
  const filtered = await filterArticles(raw, config.media_tiers)

  // 3. 영향도 HIGH → Tier → 관련성 순으로 정렬 후 총 15~20건 선택
  // 단, 카테고리 편중 방지: 한 카테고리가 전체의 60% 초과하지 않도록
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
  const processed = await summarizeAndTranslate(selected)

  // 5. DB 저장
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
  const insight = await generateInsight(processed)

  await supabase.from('run_logs').update({
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
}
