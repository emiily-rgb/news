import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('daily_alert_logs')
    .select('id, slot, slot_date, sent_at, recipients, article_count, status')
    .eq('status', 'sent')
    .order('slot_date', { ascending: false })
    .order('slot', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data ?? [] })
}
