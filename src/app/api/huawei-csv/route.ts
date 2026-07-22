import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import Parser from 'rss-parser'
import type { MediaInfo } from '@/lib/domains'
import { resolveMedia } from '@/lib/mediaResolver'

const HUAWEI_KEYWORDS = ['화웨이', 'Huawei']

// 네이버 색인 지연 보완: 수집 시작점을 이만큼 앞으로 당겨 재수집(겹침)
// 이미 직전 다운로드에 나온 기사는 huawei_csv_last_links로 제외하므로 중복 없음
const OVERLAP_MS = 2 * 60 * 60 * 1000 // 2시간

// 2026년 한국 공휴일 + 대체공휴일 (run/route.ts와 동일하게 유지)
const HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-01-28', '2026-01-29', '2026-01-30',
  '2026-03-01', '2026-03-02',
  '2026-05-05', '2026-05-25',
  '2026-06-03',
  '2026-07-17',
  '2026-08-15',
  '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-09',
  '2026-12-25',
])

function getKstDateStr(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function isNonWorkingDay(date: Date): boolean {
  const kstDate = getKstDateStr(date)
  if (HOLIDAYS_2026.has(kstDate)) return true
  // T09:00:00+09:00 = 해당 KST 날짜의 자정 UTC → getUTCDay()로 정확한 요일 계산
  const dow = new Date(kstDate + 'T09:00:00+09:00').getUTCDay()
  return dow === 0 || dow === 6
}

// fallback: 마지막 다운로드 기록 없을 때 전 영업일 10시 KST
function getFallbackStart(): Date {
  const todayKst = getKstDateStr(new Date())
  const d = new Date(`${todayKst}T10:00:00+09:00`)
  d.setDate(d.getDate() - 1)
  while (isNonWorkingDay(d)) d.setDate(d.getDate() - 1)
  const prevWorkdayKst = getKstDateStr(d)
  return new Date(`${prevWorkdayKst}T10:00:00+09:00`)
}

function stripHtml(str: string): string {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim()
}

// 제목 끝 매체명 제거: "제목 - 매체명", "제목 | 매체명", "제목 (매체명)", "제목 [매체명]"
function stripMediaSuffix(title: string): string {
  return title
    .replace(/\s*[-–|]\s*[^\-–|[\]()\n]{1,30}$/, '')
    .replace(/\s*[\[(][^\]\)]{1,30}[\])]\s*$/, '')
    .trim()
}

function toCsvRow(cells: string[]): string {
  return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
}



const rssParser = new Parser()

type Article = { title: string; link: string; pubDate: string; description: string; keyword: string }

function extractBingUrl(bingLink: string): string {
  try {
    const match = bingLink.match(/[?&]url=([^&]+)/)
    if (match) return decodeURIComponent(match[1])
  } catch { /* ignore */ }
  return bingLink
}

async function searchRss(
  rssUrl: string,
  keyword: string,
  cutoff: Date,
  cutoffEnd: Date,
  seen: Set<string>,
  extractLink?: (link: string) => string
): Promise<Article[]> {
  const results: Article[] = []
  try {
    const feed = await Promise.race([
      rssParser.parseURL(rssUrl),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]) as Awaited<ReturnType<typeof rssParser.parseURL>>

    for (const item of feed.items ?? []) {
      if (!item.title || !item.link) continue
      const pub = item.pubDate ? new Date(item.pubDate) : null
      if (!pub || isNaN(pub.getTime())) continue
      if (pub > cutoffEnd || pub < cutoff) continue

      const title = item.title
      const link = extractLink ? extractLink(item.link) : item.link
      const key = title.replace(/[\s\W]/g, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      results.push({ title, link, pubDate: pub.toISOString(), description: item.contentSnippet ?? '', keyword })
    }
  } catch { /* ignore */ }
  return results
}

type ArticleAI = { topicEn: string; remarksKo: string; remarksEn: string }

async function generateAIFields(
  articles: { title: string; description: string }[]
): Promise<ArticleAI[]> {
  const client = new Anthropic()
  const BATCH = 10
  const results: ArticleAI[] = []

  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH)
    const numbered = batch
      .map((a, j) => `[${j + 1}]\nTitle: ${a.title}\nDescription: ${a.description}`)
      .join('\n\n')

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are a Korean tech news analyst. For each article below, return a JSON array with exactly ${batch.length} objects in order.

Each object must have:
- "topicEn": English translation of the Korean title (concise, natural)
- "remarksKo": One-line Korean summary (different wording from the title, max 30 chars)
- "remarksEn": English translation of remarksKo

Return ONLY the JSON array, no explanation.

${numbered}`,
      }],
    })

    try {
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()) as ArticleAI[]
      results.push(...parsed)
    } catch {
      batch.forEach(() => results.push({ topicEn: '', remarksKo: '', remarksEn: '' }))
    }
  }

  return results
}

export async function GET(req: Request) {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Naver API 키 없음' }, { status: 500 })
  }

  const url = new URL(req.url)
  const now = new Date()
  const supabase = createServiceClient()

  // 마지막 다운로드 시점 읽기
  const { data: lastDlData } = await supabase
    .from('configs')
    .select('value')
    .eq('key', 'huawei_csv_last_download')
    .single()
  const lastDownloadAt: Date = lastDlData?.value?.timestamp
    ? new Date(lastDlData.value.timestamp)
    : getFallbackStart()

  // 색인 지연 보완: 시작점을 OVERLAP_MS 만큼 앞으로 당겨 재수집
  const cutoff = new Date(lastDownloadAt.getTime() - OVERLAP_MS)
  const cutoffEnd = now

  // 직전 다운로드에서 이미 내보낸 링크 (겹침 구간 중복 제거용)
  const { data: lastLinksData } = await supabase
    .from('configs')
    .select('value')
    .eq('key', 'huawei_csv_last_links')
    .single()
  const prevLinks = new Set<string>(lastLinksData?.value?.links ?? [])

  const seen = new Set<string>()
  const articles: { title: string; link: string; pubDate: string; description: string; keyword: string }[] = []

  for (const keyword of HUAWEI_KEYWORDS) {
    for (const sort of ['date', 'sim']) {
    try {
      const q = encodeURIComponent(keyword)
      let start = 1
      let allOld = false

      while (start <= 1000 && !allOld) {
        const apiUrl = `https://openapi.naver.com/v1/search/news.json?query=${q}&display=100&start=${start}&sort=${sort}`
        const res = await fetch(apiUrl, {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) break

        const data = await res.json() as {
          total: number
          items: Array<{ title: string; link: string; originallink: string; pubDate: string; description: string }>
        }

        const items = data.items ?? []
        if (items.length === 0) break

        console.log(`[huawei-csv] keyword=${keyword} start=${start} items=${items.length} first="${items[0]?.pubDate}"`)

        // 이 페이지의 기사 중 가장 최신이 cutoff보다 오래됐으면 더 이상 볼 필요 없음
        const newest = items[0]?.pubDate ? new Date(items[0].pubDate) : null
        if (newest && isNaN(newest.getTime())) console.log(`[huawei-csv] WARN: newest pubDate parse failed: "${items[0]?.pubDate}"`)
        if (newest && !isNaN(newest.getTime()) && newest < cutoff) { allOld = true; break }

        for (const item of items) {
          const link = item.originallink || item.link
          const title = stripMediaSuffix(stripHtml(item.title))
          const description = stripHtml(item.description)

          if (!title || !link) continue

          const pub = item.pubDate ? new Date(item.pubDate) : null
          if (!pub || isNaN(pub.getTime())) continue

          // 윈도우 범위 밖 기사는 스킵 (수집은 계속)
          if (pub > cutoffEnd || pub < cutoff) continue

          const key = link
          if (seen.has(key)) continue
          seen.add(key)

          articles.push({ title, link, pubDate: pub.toISOString(), description, keyword })
        }

        start += 100
      }
    } catch {
      // 키워드/정렬 오류 무시하고 계속
    }
    } // end sort loop
  }

  const naverCount = articles.length
  console.log(`[huawei-csv] Naver 수집 완료: ${naverCount}건`)

  // Google News + Bing News 병렬 수집
  const [googleResults, bingResults] = await Promise.all([
    Promise.all(HUAWEI_KEYWORDS.map(kw =>
      searchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=ko&gl=KR&ceid=KR:ko`, kw, cutoff, cutoffEnd, seen)
    )),
    Promise.all(HUAWEI_KEYWORDS.map(kw =>
      searchRss(`https://www.bing.com/news/search?q=${encodeURIComponent(kw)}&format=rss`, kw, cutoff, cutoffEnd, seen, extractBingUrl)
    )),
  ])
  const googleCount = googleResults.flat().length
  for (const results of googleResults) articles.push(...results)
  for (const results of bingResults) articles.push(...results)
  const bingCount = articles.length - naverCount - googleCount
  console.log(`[huawei-csv] Google ${googleCount}건, Bing ${bingCount}건, 총 ${articles.length}건`)

  // debug=true 이면 수집 결과 JSON으로 반환
  if (url.searchParams.get('debug') === 'true') {
    return NextResponse.json({
      total: articles.length,
      naver: naverCount,
      google: googleCount,
      bing: bingCount,
      window: { start: cutoff.toISOString(), end: cutoffEnd.toISOString() },
      titles: articles.map(a => ({ date: a.pubDate.slice(0, 10), title: a.title })),
    })
  }

  // 최신순 정렬
  articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

  // 직전 다운로드에서 이미 내보낸 기사(겹침 구간) 제외 후, 도메인별 매체 정보 조회
  // (모르는 도메인은 버리지 않고 'Unknown'으로 임시 등록 + 포함시킨다. status='excluded'인 도메인만 제외됨)
  const candidates = articles.filter(a => !prevLinks.has(a.link))
  const resolvedInfos = await Promise.all(candidates.map(a => resolveMedia(a.link)))
  const filtered: { article: typeof candidates[0]; info: MediaInfo }[] = []
  candidates.forEach((article, i) => {
    const info = resolvedInfos[i]
    if (info) filtered.push({ article, info })
  })

  // 등록된 매체 먼저, 미등록('Unknown') 매체는 맨 아래로 (각 그룹 내에서는 최신순 유지)
  filtered.sort((a, b) => {
    const pendingDiff = Number(a.info.mediaType === 'Unknown') - Number(b.info.mediaType === 'Unknown')
    if (pendingDiff !== 0) return pendingDiff
    return new Date(b.article.pubDate).getTime() - new Date(a.article.pubDate).getTime()
  })

  const todayKST = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const yymmdd = todayKST.replace(/-/g, '').slice(2)
  const filename = `${yymmdd}_Huawei_articles.csv`

  // Claude AI로 Topic 영문번역 + Remarks 생성
  const aiFields = process.env.ANTHROPIC_API_KEY
    ? await generateAIFields(filtered.map(f => f.article))
    : filtered.map(() => ({ topicEn: '', remarksKo: '', remarksEn: '' }))

  // CSV 생성
  const headers = ['Date', 'Title', 'URL', 'Topic', 'Media Type', 'Company', 'Remarks']
  const rows = filtered.map(({ article: a, info: { company, mediaType } }, i) => {
    const ai = aiFields[i] ?? { topicEn: '', remarksKo: '', remarksEn: '' }
    const topic = ai.topicEn ? `${a.title}\n${ai.topicEn}` : a.title
    const remarks = ai.remarksKo && ai.remarksEn ? `${ai.remarksKo}\n${ai.remarksEn}` : ''
    return toCsvRow([
      new Date(a.pubDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
      a.title,
      a.link,
      topic,
      mediaType,
      company,
      remarks,
    ])
  })

  const csv = ['﻿' + toCsvRow(headers), ...rows].join('\n')

  // 마지막 다운로드 시점 + 이번에 내보낸 링크 저장 (다음 겹침 구간 중복 제거용)
  await supabase.from('configs').upsert({ key: 'huawei_csv_last_download', value: { timestamp: now.toISOString() } })
  await supabase.from('configs').upsert({ key: 'huawei_csv_last_links', value: { links: filtered.map(f => f.article.link) } })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
