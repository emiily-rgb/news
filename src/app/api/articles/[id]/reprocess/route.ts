import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processManualArticle } from '@/services/ai'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: article, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !article) return NextResponse.json({ error: '기사를 찾을 수 없음' }, { status: 404 })

  const result = await processManualArticle({
    url: article.link,
    title: article.title,
    bodyText: '',
    media: article.media,
    pubDate: article.pub_date,
  })

  const update = {
    summary_ko: result.summary_ko ?? [],
    summary_zh: result.summary_zh ?? [],
    title_zh: result.title_zh || article.title_zh,
    why_it_matters_ko: result.why_it_matters_ko ?? article.why_it_matters_ko,
    why_it_matters_zh: result.why_it_matters_zh ?? article.why_it_matters_zh,
  }

  const { data: updated, error: updateError } = await supabase
    .from('articles')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json(updated)
}
