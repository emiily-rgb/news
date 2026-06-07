import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function getKstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const kstNow = getKstNow()
  const slotDate = url.searchParams.get('slot_date') ?? kstNow.toLocaleDateString('en-CA')
  const slot = url.searchParams.get('slot') ? parseInt(url.searchParams.get('slot')!) : null

  const supabase = createServiceClient()

  let query = supabase
    .from('daily_alert_articles')
    .select('id, slot, slot_date, title, link, pub_date, media, category, keyword, excluded, collected_at')
    .eq('slot_date', slotDate)
    .order('pub_date', { ascending: false })

  if (slot) query = query.eq('slot', slot)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ articles: data ?? [] })
}

export async function PATCH(req: Request) {
  const { id, excluded } = await req.json()
  if (!id || excluded === undefined) {
    return NextResponse.json({ error: 'id, excluded 필수' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('daily_alert_articles')
    .update({ excluded })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
