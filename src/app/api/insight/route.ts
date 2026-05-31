import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateInsight } from '@/services/ai'

export async function POST(req: NextRequest) {
  const { runId } = await req.json()
  const supabase = createServiceClient()

  const { data: articles } = await supabase
    .from('articles')
    .select('*')
    .eq('run_id', runId)

  if (!articles) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const insight = await generateInsight(articles)

  await supabase.from('run_logs').update({
    insight_ko: insight.ko,
    insight_zh: insight.zh,
    key_takeaways: insight.keyTakeaways,
    emerging_signals: insight.emergingSignals,
    tomorrow_watchlist: insight.tomorrowWatchlist,
    insight_generated_at: new Date().toISOString(),
  }).eq('id', runId)

  return NextResponse.json(insight)
}

export async function PATCH(req: NextRequest) {
  const { runId, insight_ko, insight_zh } = await req.json()
  const supabase = createServiceClient()
  await supabase.from('run_logs').update({ insight_ko, insight_zh }).eq('id', runId)
  return NextResponse.json({ ok: true })
}
