import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processManualArticle } from '@/services/ai'
import { randomUUID } from 'crypto'

// HTML에서 텍스트 추출 (간단한 파서)
function extractFromHtml(html: string): { title: string; bodyText: string; media: string; pubDate: string } {
  // 스크립트/스타일 제거
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  function decodeEntities(s: string) {
    return s
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&nbsp;/g, ' ').trim()
  }

  // 제목
  const ogTitle = clean.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1]
  const titleTag = clean.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
  const h1Tag = clean.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
  const title = decodeEntities(ogTitle || h1Tag || titleTag || '')

  // 발행 날짜
  const datePatterns = [
    /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i,
    /<meta[^>]*name="pubdate"[^>]*content="([^"]+)"/i,
    /<time[^>]*datetime="([^"]+)"/i,
  ]
  let pubDate = new Date().toISOString()
  for (const pattern of datePatterns) {
    const m = clean.match(pattern)
    if (m?.[1]) { pubDate = m[1]; break }
  }

  // 매체명
  const ogSite = clean.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i)?.[1]
  const media = (ogSite || '').trim()

  // 본문 텍스트
  const bodyText = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 5000)

  return { title, bodyText, media, pubDate }
}

// 데이터센터 IP 차단(403 등)으로 직접 fetch가 막힌 사이트용 리더 프록시 폴백.
// r.jina.ai 가 서버측에서 렌더링해 제목/발행시각/본문을 텍스트로 돌려준다.
async function fetchViaReader(url: string): Promise<{ title: string; bodyText: string; pubDate: string }> {
  // 기본 응답(Title:/Published Time:/Markdown Content: 메타 포함)을 받아야 제목 파싱이 됨.
  // X-Return-Format:text 를 주면 메타가 빠지므로 설정하지 않는다.
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) throw new Error(`reader HTTP ${res.status}`)
  const text = await res.text()

  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const pubMatch = text.match(/^Published Time:\s*(.+)$/m)?.[1]?.trim()
  const pubDate = pubMatch || new Date().toISOString()
  const bodyStart = text.indexOf('Markdown Content:')
  const bodyText = (bodyStart >= 0 ? text.slice(bodyStart + 'Markdown Content:'.length) : text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 마크다운 링크 → 텍스트만
    .replace(/[#*>`]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 5000)

  return { title, bodyText, pubDate }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const { urls, forceCategory } = await req.json() as { urls: string[]; forceCategory?: string }

  if (!urls?.length) return NextResponse.json({ error: 'URL이 없습니다' }, { status: 400 })

  const supabase = createServiceClient()

  // 현재 run에 몇 번째 기사까지 있는지 확인 (order_index 이어받기)
  const { data: existing } = await supabase
    .from('articles')
    .select('order_index, category')
    .eq('run_id', runId)

  // 카테고리별 마지막 order_index
  const maxOrderByCategory: Record<string, number> = {}
  ;(existing ?? []).forEach(a => {
    const cat = a.category as string
    const idx = (a.order_index as number) ?? 0
    maxOrderByCategory[cat] = Math.max(maxOrderByCategory[cat] ?? -1, idx)
  })

  const results: { url: string; status: 'ok' | 'error'; error?: string; article?: object }[] = []

  for (const url of urls) {
    try {
      // 1. 기사 HTML 가져오기 (직접 fetch → 실패 시 리더 프록시 폴백)
      let title = ''
      let bodyText = ''
      let pubDate = new Date().toISOString()
      let ogMedia = ''
      try {
        const fetchRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ko-KR,ko;q=0.9,zh-CN;q=0.8',
          },
          signal: AbortSignal.timeout(15000),
        })
        if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`)
        const html = await fetchRes.text()
        ;({ title, bodyText, pubDate, media: ogMedia } = extractFromHtml(html))
      } catch (directErr) {
        // 데이터센터 IP 차단(403 등) 또는 타임아웃 → 리더 프록시로 재시도
        const msg = directErr instanceof Error ? directErr.message : String(directErr)
        console.warn(`[manual-articles] 직접 fetch 실패(${msg}), 리더 프록시 폴백: ${url}`)
        ;({ title, bodyText, pubDate } = await fetchViaReader(url))
      }

      // 2. 매체명 결정
      const domain = new URL(url).hostname.replace(/^www\./, '')
      const MEDIA_MAP: Record<string, string> = {
        'sedaily.com': '서울경제',
        'mk.co.kr': '매일경제',
        'hankyung.com': '한국경제',
        'chosun.com': '조선일보',
        'joongang.co.kr': '중앙일보',
        'donga.com': '동아일보',
        'hani.co.kr': '한겨레',
        'khan.co.kr': '경향신문',
        'yna.co.kr': '연합뉴스',
        'yonhapnewstv.co.kr': '연합뉴스TV',
        'newsis.com': '뉴시스',
        'news1.kr': '뉴스1',
        'mt.co.kr': '머니투데이',
        'etnews.com': '전자신문',
        'zdnet.co.kr': 'ZDNet Korea',
        'itchosun.com': 'IT조선',
        'bloter.net': '블로터',
        'techm.kr': '테크M',
        'digitaltoday.co.kr': '디지털투데이',
        'aitimes.com': 'AI타임스',
        'reuters.com': 'Reuters',
        'bloomberg.com': 'Bloomberg',
        'ft.com': 'Financial Times',
        'wsj.com': 'Wall Street Journal',
        'nytimes.com': 'New York Times',
        'techcrunch.com': 'TechCrunch',
        'theverge.com': 'The Verge',
        'wired.com': 'Wired',
      }
      const mediaName = ogMedia || MEDIA_MAP[domain] || domain.replace(/\.(com|co\.kr|net|or\.kr|kr)$/, '').replace(/[-_.]/g, ' ')

      if (!title) throw new Error('제목을 추출할 수 없습니다')

      // 제목 내 따옴표 제거 (AI JSON 파싱 오류 방지)
      const safeTitle = title.replace(/"/g, "'").replace(/\\/g, '')

      // 3. AI 처리
      const processed = await processManualArticle({
        url,
        title: safeTitle,
        bodyText,
        media: mediaName,
        pubDate,
      })

      // 4. order_index 계산 (강제 카테고리 적용)
      if (forceCategory) processed.category = forceCategory
      const cat = processed.category ?? '업계'
      maxOrderByCategory[cat] = (maxOrderByCategory[cat] ?? -1) + 1
      const orderIndex = maxOrderByCategory[cat]

      // 5. DB 저장
      const { data: inserted, error: dbErr } = await supabase
        .from('articles')
        .insert({
          id: randomUUID(),
          run_id: runId,
          ...processed,
          order_index: orderIndex,
          is_manual: true,
        })
        .select()
        .single()

      if (dbErr) throw new Error(dbErr.message)

      results.push({ url, status: 'ok', article: inserted })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[manual-articles] 실패: ${url} →`, msg)
      results.push({ url, status: 'error', error: msg })
    }
  }

  return NextResponse.json({ results })
}
