import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('run_logs')
    .select('id, run_at, status, total_collected, total_after_filter, sent_at, insight_ko, insight_zh, draft_saved_at')
    .order('run_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}
