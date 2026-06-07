import { NextResponse } from 'next/server'

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

  // CSV 생성
  const headers = ['Date', 'Title', 'URL', 'Description', 'Keyword']
  const rows = articles.map(a => toCsvRow([
    new Date(a.pubDate).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    a.title,
    a.link,
    a.description,
    a.keyword,
  ]))

  const csv = ['﻿' + toCsvRow(headers), ...rows].join('\n')

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '')
  const filename = `${today}_Huawei_All_Articles.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
