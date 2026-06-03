import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { collectArticles } from '@/services/collector'
import { getConfig } from '@/lib/config'

function getKstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

function getSlot(kstHour: number): number | null {
  if (kstHour >= 10 && kstHour < 13) return 12
  if (kstHour >= 14 && kstHour < 17) return 16
  if (kstHour >= 19 && kstHour < 22) return 21
  return null
}

function getSlotDate(kstNow: Date): string {
  return kstNow.toLocaleDateString('en-CA') // YYYY-MM-DD
}

// 제목 유사도 — 핵심 토큰 70% 이상 겹치면 중복
function isSimilarTitle(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/[\s\W]/g, '').toLowerCase()
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return true
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (shorter.length > 10 && longer.includes(shorter)) return true
  const tokA = a.split(/\s+/).filter(t => t.length > 2)
  const tokB = new Set(b.split(/\s+/).filter(t => t.length > 2))
  if (tokA.length === 0 || tokB.size === 0) return false
  const overlap = tokA.filter(t => tokB.has(t)).length
  return overlap / Math.min(tokA.length, tokB.size) >= 0.7
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const forceSlot = url.searchParams.get('slot')

  const kstNow = getKstNow()
  const slot = forceSlot ? parseInt(forceSlot) : getSlot(kstNow.getHours())

  if (!slot) {
    return NextResponse.json({ message: '수집 시간대 아님', hour: kstNow.getHours() })
  }

  const slotDate = getSlotDate(kstNow)
  const supabase = createServiceClient()
  const config = await getConfig()

  // 5시간치 기사 수집
  const raw = await collectArticles(config.keywords, 5)

  // 오늘 이미 저장된 링크 조회 (모든 슬롯 통틀어 중복 방지)
  const { data: existing } = await supabase
    .from('daily_alert_articles')
    .select('link, title')
    .eq('slot_date', slotDate)

  const existingLinks = new Set((existing ?? []).map(r => r.link))
  const existingTitles = (existing ?? []).map(r => r.title)

  // 배치 내 중복 제거 + 기존 저장분 중복 제거
  const seen = new Set<string>()
  const batchTitles: string[] = []
  const toInsert: typeof raw = []

  for (const article of raw) {
    if (existingLinks.has(article.link)) continue
    if (seen.has(article.link)) continue

    const isDupTitle =
      existingTitles.some(t => isSimilarTitle(t, article.title)) ||
      batchTitles.some(t => isSimilarTitle(t, article.title))

    if (isDupTitle) continue

    seen.add(article.link)
    batchTitles.push(article.title)
    toInsert.push(article)
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ slot, slotDate, inserted: 0 })
  }

  const rows = toInsert.map(a => ({
    slot,
    slot_date: slotDate,
    title: a.title,
    link: a.link,
    pub_date: a.pubDate,
    media: a.media,
    category: a.category,
    keyword: a.keyword,
  }))

  const { error } = await supabase
    .from('daily_alert_articles')
    .insert(rows)

  if (error) {
    console.error('[daily-alert/collect] DB insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ slot, slotDate, inserted: rows.length })
}
