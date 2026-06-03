import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getConfig } from '@/lib/config'
import { filterArticles, summarizeAndTranslate, generateInsight } from '@/services/ai'
import { v4 as uuidv4 } from 'uuid'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = createServiceClient()

  // raw_articles 가져오기
  const { data: runData } = await supabase
    .from('run_logs')
    .select('raw_articles, total_collected, status')
    .eq('id', runId)
    .single()

  if (!runData) return NextResponse.json({ error: 'run을 찾을 수 없음' }, { status: 404 })
  if (runData.status === 'completed') return NextResponse.json({ message: '이미 완료됨' })

  // 2단계 시작
  processPipeline(runId, supabase, runData.raw_articles ?? []).catch(async (err) => {
    console.error('처리 오류:', err)
    await supabase.from('run_logs').update({ status: 'failed', error: String(err) }).eq('id', runId)
  })

  return NextResponse.json({ ok: true })
}

const MIN_TOTAL = 15
const MAX_TOTAL = 20

async function processPipeline(
  runId: string,
  supabase: ReturnType<typeof createServiceClient>,
  raw: any[]
) {
  const setStep = (step: string) =>
    supabase.from('run_logs').update({ current_step: step, status: 'running' }).eq('id', runId)

  const config = await getConfig()

  // 2. AI 필터링
  await setStep('filtering')
  const filtered = await filterArticles(raw, config.media_tiers)

  // 3. 정렬 + 선택
  await setStep('selecting')
  const impactOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  const sorted = filtered.sort((a, b) => {
    const impactDiff = (impactOrder[a.impactLevel] ?? 2) - (impactOrder[b.impactLevel] ?? 2)
    if (impactDiff !== 0) return impactDiff
    if (a.mediaTier !== b.mediaTier) return a.mediaTier - b.mediaTier
    return b.relevanceScore - a.relevanceScore
  })

  const selected: typeof filtered = []
  const catCount: Record<string, number> = {}
  const maxPerCat = Math.ceil(MAX_TOTAL * 0.6)

  for (const article of sorted) {
    if (selected.length >= MAX_TOTAL) break
    const cat = article.finalCategory
    if ((catCount[cat] ?? 0) >= maxPerCat) continue
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

  // 4. 요약 + 번역
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

  // 6. Executive Brief
  await setStep('briefing')
  const insight = await generateInsight(processed)

  await supabase.from('run_logs').update({
    status: 'completed',
    current_step: 'completed',
    total_after_filter: selected.length,
    insight_ko: insight.ko,
    insight_zh: insight.zh,
    key_takeaways: insight.keyTakeaways,
    emerging_signals: insight.emergingSignals,
    tomorrow_watchlist: insight.tomorrowWatchlist,
    insight_generated_at: new Date().toISOString(),
    recipients: config.recipients,
    draft_saved_at: new Date().toISOString(),
    raw_articles: null, // 정리
  }).eq('id', runId)

  console.log(`[처리완료] runId=${runId}, 선택=${selected.length}건`)
}
