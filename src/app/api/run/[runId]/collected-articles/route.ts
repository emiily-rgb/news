import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { RawArticle } from '@/services/collector'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = createServiceClient()

  const { data: runLog } = await supabase
    .from('run_logs')
    .select('raw_articles')
    .eq('id', runId)
    .single()

  const raw = (runLog?.raw_articles as RawArticle[] | null) ?? []

  const { data: keptRows } = await supabase
    .from('articles')
    .select('link, excluded')
    .eq('run_id', runId)

  const keptLinks = new Set((keptRows ?? []).filter(r => !r.excluded).map(r => r.link as string))

  const seen = new Set<string>()
  const articles = raw
    .filter(a => {
      if (!a.link || seen.has(a.link)) return false
      seen.add(a.link)
      return true
    })
    .map((a, i) => ({
      id: `${i}`,
      title: a.title,
      link: a.link,
      media: a.media,
      pub_date: a.pubDate,
      category: a.category,
      excluded: !keptLinks.has(a.link),
    }))
    .sort((a, b) => Number(b.excluded) - Number(a.excluded))

  return NextResponse.json({
    articles,
    total: articles.length,
    excludedCount: articles.filter(a => a.excluded).length,
  })
}
