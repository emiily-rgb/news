import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = createServiceClient()

  const { data: runLog } = await supabase
    .from('run_logs')
    .select('*')
    .eq('id', runId)
    .single()

  if (!runLog) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: articles } = await supabase
    .from('articles')
    .select('*')
    .eq('run_id', runId)
    .order('order_index')

  return NextResponse.json({ runLog, articles: articles ?? [] })
}
