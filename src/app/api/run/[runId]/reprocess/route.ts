import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processManualArticle } from '@/services/ai'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = createServiceClient()

  const { data: articles, error } = await supabase
    .from('articles')
    .select('*')
    .eq('run_id', runId)
    .eq('excluded', false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const missing = (articles ?? []).filter(
    a => !a.summary_ko || a.summary_ko.length === 0
  )

  if (missing.length === 0) return NextResponse.json({ count: 0 })

  after(async () => {
    for (const article of missing) {
      try {
        const result = await processManualArticle({
          url: article.link,
          title: article.title,
          bodyText: '',
          media: article.media,
          pubDate: article.pub_date,
        })
        await supabase
          .from('articles')
          .update({
            summary_ko: result.summary_ko ?? [],
            summary_zh: result.summary_zh ?? [],
            title_zh: result.title_zh ?? article.title_zh,
            why_it_matters_ko: result.why_it_matters_ko ?? article.why_it_matters_ko,
            why_it_matters_zh: result.why_it_matters_zh ?? article.why_it_matters_zh,
          })
          .eq('id', article.id)
      } catch (err) {
        console.error(`[reprocess] 실패: ${article.title}`, err)
      }
    }
  })

  return NextResponse.json({ count: missing.length })
}
