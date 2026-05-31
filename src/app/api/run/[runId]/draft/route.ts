import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId: id } = await params
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('run_logs')
    .update({ draft_saved_at: new Date().toISOString() })
    .eq('id', id)
    .select('draft_saved_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ draft_saved_at: data.draft_saved_at })
}
