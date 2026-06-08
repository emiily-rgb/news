import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'

const HUAWEI_KEYWORDS = ['화웨이', 'Huawei']

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

// 연관기사 등 사이드 섹션 제거 후 본문에 화웨이 포함 여부 확인
async function hasHuaweiInBody(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return true // 못 가져오면 일단 포함 처리
    const html = await res.text()

    // 연관기사/추천기사 섹션 제거 (주요 패턴)
    const cleaned = html
      .replace(/<(section|div|ul|aside)[^>]*(?:related|recommend|연관|관련기사|랭킹|popular)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')

    return cleaned.toLowerCase().includes('화웨이') || cleaned.toLowerCase().includes('huawei')
  } catch {
    return true // 오류 시 포함 처리 (안전하게)
  }
}

async function filterByBody(
  articles: { title: string; link: string; pubDate: string; description: string; keyword: string }[]
) {
  const PARALLEL = 10
  const results: typeof articles = []

  for (let i = 0; i < articles.length; i += PARALLEL) {
    const batch = articles.slice(i, i + PARALLEL)
    const checks = await Promise.all(batch.map(a => hasHuaweiInBody(a.link)))
    batch.forEach((a, j) => { if (checks[j]) results.push(a) })
  }

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

  // hoursBack 파라미터 (기본 72시간 — 금~월 주말 커버)
  const url = new URL(req.url)
  const hoursBack = Math.max(1, Number(url.searchParams.get('hoursBack') ?? '72'))
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

  const seen = new Set<string>()
  const articles: { title: string; link: string; pubDate: string; description: string; keyword: string }[] = []

  for (const keyword of HUAWEI_KEYWORDS) {
    try {
      const q = encodeURIComponent(keyword)
      const apiUrl = `https://openapi.naver.com/v1/search/news.json?query=${q}&display=100&sort=date`
      const res = await fetch(apiUrl, {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue

      const data = await res.json() as {
        items: Array<{ title: string; link: string; originallink: string; pubDate: string; description: string }>
      }

      for (const item of data.items ?? []) {
        const link = item.originallink || item.link
        const title = stripHtml(item.title)
        const description = stripHtml(item.description)

        if (!title || !link) continue

        const pub = item.pubDate ? new Date(item.pubDate) : null
        if (!pub || pub < cutoff) continue

        // 제목 또는 설명에 '화웨이' 또는 'Huawei' 포함 여부 확인
        const combined = (title + ' ' + description).toLowerCase()
        if (!combined.includes('화웨이') && !combined.includes('huawei')) continue

        const key = title.replace(/[\s\W]/g, '').toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        articles.push({ title, link, pubDate: pub.toISOString(), description, keyword })
      }
    } catch {
      // 키워드별 오류 무시하고 계속
    }
  }

  // 최신순 정렬
  articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

  // 본문 크롤링으로 화웨이 미포함 기사 제거
  const filtered = await filterByBody(articles)

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
  await supabase.from('huawei_csv_cache').upsert({ date: todayKST, csv_content: csv })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
