import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const supabase = createServiceClient()

  const allowed = ['excluded', 'summary_ko', 'summary_zh', 'title_zh', 'why_it_matters_ko', 'why_it_matters_zh', 'image_url', 'order_index', 'category']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  if (body.excluded !== undefined) {
    update.excluded_at = body.excluded ? new Date().toISOString() : null
  }

  const { data, error } = await supabase
    .from('articles')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[PATCH /api/articles/:id]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const { error } = await supabase.from('articles').delete().eq('id', id)
  if (error) {
    console.error('[DELETE /api/articles/:id]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
