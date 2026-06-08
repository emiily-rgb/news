import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServiceClient()
  const todayKST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })

  const { data } = await supabase
    .from('huawei_csv_cache')
    .select('date, created_at')
    .eq('date', todayKST)
    .single()

  return NextResponse.json({ cached: !!data, createdAt: data?.created_at ?? null })
}
