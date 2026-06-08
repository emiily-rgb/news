import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import Parser from 'rss-parser'

const HUAWEI_KEYWORDS = ['화웨이', 'Huawei']

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

// 브리핑 수집 윈도우: 전 영업일 오전 8시 KST ~ 오늘 오전 8시 KST
function getBriefingWindow(): { start: Date; end: Date } {
  const nowKst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const todayKst = getKstDateStr(new Date())

  // 오늘 오전 8시 KST
  const end = new Date(`${todayKst}T08:00:00+09:00`)

  // 전 영업일 찾기 (어제부터 거슬러 올라가며 영업일 찾음)
  const d = new Date(end)
  d.setDate(d.getDate() - 1)
  while (isNonWorkingDay(d)) {
    d.setDate(d.getDate() - 1)
  }
  const prevWorkdayKst = getKstDateStr(d)
  const start = new Date(`${prevWorkdayKst}T08:00:00+09:00`)

  // 현재 시각이 오늘 8시 이전이면 end를 현재 시각으로 (아직 오늘 윈도우가 안 열린 경우)
  const now = new Date()
  return { start, end: end > now ? now : end }
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

function toCsvRow(cells: string[]): string {
  return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
}

type MediaInfo = { company: string; mediaType: string }

const DOMAIN_MAP: Record<string, MediaInfo> = {
  'digitaltoday.co.kr':  { company: '디지털투데이', mediaType: 'IT/Tech' },
  'etnews.com':          { company: '전자신문',      mediaType: 'IT/Tech' },
  'zdnet.co.kr':         { company: 'ZDNet Korea',   mediaType: 'IT/Tech' },
  'itworld.co.kr':       { company: 'IT World',      mediaType: 'IT/Tech' },
  'cio.co.kr':           { company: 'CIO Korea',     mediaType: 'IT/Tech' },
  'aitimes.com':         { company: 'AI타임스',      mediaType: 'IT/Tech' },
  'aitimes.kr':          { company: 'AI타임스',      mediaType: 'IT/Tech' },
  'techrecipe.co.kr':    { company: '테크레시피',    mediaType: 'IT/Tech' },
  'bloter.net':          { company: '블로터',        mediaType: 'IT/Tech' },
  'ddaily.co.kr':        { company: '디지털데일리',  mediaType: 'IT/Tech' },
  'boannews.com':        { company: '보안뉴스',      mediaType: 'IT/Tech' },
  'chosun.com':          { company: '조선일보',      mediaType: 'Newspaper' },
  'joongang.co.kr':      { company: '중앙일보',      mediaType: 'Newspaper' },
  'donga.com':           { company: '동아일보',      mediaType: 'Newspaper' },
  'hani.co.kr':          { company: '한겨레',        mediaType: 'Newspaper' },
  'hankyung.com':        { company: '한국경제',      mediaType: 'Newspaper' },
  'mk.co.kr':            { company: '매일경제',      mediaType: 'Newspaper' },
  'sedaily.com':         { company: '서울경제',      mediaType: 'Newspaper' },
  'fnnews.com':          { company: '파이낸셜뉴스',  mediaType: 'Newspaper' },
  'heraldcorp.com':      { company: '헤럴드경제',    mediaType: 'Newspaper' },
  'etoday.co.kr':        { company: '이투데이',      mediaType: 'Newspaper' },
  'mt.co.kr':            { company: '머니투데이',    mediaType: 'Newspaper' },
  'newsis.com':          { company: '뉴시스',        mediaType: 'Online' },
  'news1.kr':            { company: '뉴스1',         mediaType: 'Online' },
  'yonhapnews.co.kr':    { company: '연합뉴스',      mediaType: 'Online' },
  'yna.co.kr':           { company: '연합뉴스',      mediaType: 'Online' },
  'biz.chosun.com':      { company: '조선비즈',      mediaType: 'Online' },
  'dealsite.co.kr':      { company: '딜사이트',      mediaType: 'Online' },
  'joseilbo.com':        { company: '조세일보',      mediaType: 'Online' },
}


const rssParser = new Parser()

type Article = { title: string; link: string; pubDate: string; description: string; keyword: string }

async function searchGoogle(
  keyword: string,
  cutoff: Date,
  cutoffEnd: Date,
  seen: Set<string>
): Promise<Article[]> {
  const results: Article[] = []
  try {
    const q = encodeURIComponent(keyword)
    const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`
    const feed = await Promise.race([
      rssParser.parseURL(url),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]) as Awaited<ReturnType<typeof rssParser.parseURL>>

    for (const item of feed.items ?? []) {
      if (!item.title || !item.link) continue
      const pub = item.pubDate ? new Date(item.pubDate) : null
      if (!pub || isNaN(pub.getTime())) continue
      if (pub > cutoffEnd || pub < cutoff) continue

      const title = item.title
      const key = title.replace(/[\s\W]/g, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      results.push({ title, link: item.link, pubDate: pub.toISOString(), description: item.contentSnippet ?? '', keyword })
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

function extractMediaInfo(url: string): MediaInfo {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    for (const [domain, info] of Object.entries(DOMAIN_MAP)) {
      if (hostname.includes(domain)) return info
    }
    return { company: hostname, mediaType: 'Online' }
  } catch {
    return { company: '', mediaType: '' }
  }
}

export async function GET(req: Request) {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Naver API 키 없음' }, { status: 500 })
  }

  const url = new URL(req.url)
  const { start: cutoff, end: cutoffEnd } = getBriefingWindow()

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
          const title = stripHtml(item.title)
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

  // Google News 검색 병렬 실행
  const googleResults = await Promise.all(
    HUAWEI_KEYWORDS.map(kw => searchGoogle(kw, cutoff, cutoffEnd, seen))
  )
  for (const results of googleResults) articles.push(...results)
  console.log(`[huawei-csv] Google 수집 완료: ${articles.length - naverCount}건, 총 ${articles.length}건`)

  // debug=true 이면 수집 결과 JSON으로 반환
  if (url.searchParams.get('debug') === 'true') {
    return NextResponse.json({
      total: articles.length,
      naver: naverCount,
      google: articles.length - naverCount,
      window: { start: cutoff.toISOString(), end: cutoffEnd.toISOString() },
      titles: articles.map(a => ({ date: a.pubDate.slice(0, 10), title: a.title })),
    })
  }

  // 최신순 정렬
  articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

  const filtered = articles

  const todayKST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const yymmdd = todayKST.replace(/-/g, '').slice(2)
  const filename = `${yymmdd}_Huawei_articles.csv`

  // 오늘 캐시 확인 (force=true면 무시)
  const force = url.searchParams.get('force') === 'true'
  const supabase = createServiceClient()
  const { data: cached } = await supabase
    .from('huawei_csv_cache')
    .select('csv_content')
    .eq('date', todayKST)
    .single()

  if (!force && cached?.csv_content) {
    return new NextResponse(cached.csv_content, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // Claude AI로 Topic 영문번역 + Remarks 생성
  const aiFields = process.env.ANTHROPIC_API_KEY
    ? await generateAIFields(filtered)
    : filtered.map(() => ({ topicEn: '', remarksKo: '', remarksEn: '' }))

  // CSV 생성
  const headers = ['Date', 'Title', 'URL', 'Topic', 'Media Type', 'Company', 'Remarks']
  const rows = filtered.map((a, i) => {
    const { company, mediaType } = extractMediaInfo(a.link)
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

  // 캐시 저장
  await supabase.from('huawei_csv_cache').upsert({ date: todayKST, csv_content: csv, created_at: new Date().toISOString() })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
