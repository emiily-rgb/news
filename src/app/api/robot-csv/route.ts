import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import type { MediaInfo } from '@/lib/domains'
import { resolveMedia } from '@/lib/mediaResolver'

export const maxDuration = 300

// 로봇 산업 풀리스트: 화웨이 풀리스트(/api/huawei-csv)와 동일한 방식이되, 네이버 검색만 사용하고
// 마지막 다운로드 시점·링크도 별도 키로 관리해서 화웨이 풀리스트와 서로 영향을 주지 않는다.
const ROBOT_KEYWORDS = [
  '화인로보틱스', '애지봇', '유니트리', '유비테크', '아이엘로보틱스',
  '로보틱스', '피지컬 AI', '휴머노이드', '로봇 핸드', '로봇 데이터',
]

const LAST_DOWNLOAD_KEY = 'robot_csv_last_download'
const LAST_LINKS_KEY = 'robot_csv_last_links'

// 네이버 색인 지연 보완: 수집 시작점을 이만큼 앞으로 당겨 재수집(겹침)
// 이미 직전 다운로드에 나온 기사는 LAST_LINKS_KEY로 제외하므로 중복 없음
const OVERLAP_MS = 2 * 60 * 60 * 1000 // 2시간

// 2026년 한국 공휴일 + 대체공휴일 (run/route.ts, huawei-csv/route.ts와 동일하게 유지)
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

function dedupKey(title: string): string {
  return title.replace(/[\s\W]/g, '').toLowerCase()
}

function toCsvRow(cells: string[]): string {
  return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
}

type Article = { title: string; link: string; pubDate: string; description: string; keyword: string }
type ArticleAI = { topicEn: string }

const EMPTY_AI: ArticleAI = { topicEn: '' }

const isCompleteAI = (r?: ArticleAI) => typeof r?.topicEn === 'string' && !!r.topicEn.trim()

// 영문 제목 번역 — 리마크 칸에 "한국어 제목 + 영문 제목"으로 들어간다
async function generateAIFields(articles: { title: string; description: string }[]): Promise<ArticleAI[]> {
  const client = new Anthropic()
  const BATCH = 10
  const CONCURRENCY = 10

  const batches: { title: string; description: string }[][] = []
  for (let i = 0; i < articles.length; i += BATCH) batches.push(articles.slice(i, i + BATCH))

  async function runBatch(batch: { title: string; description: string }[]): Promise<ArticleAI[]> {
    const numbered = batch
      .map((a, j) => `[${j + 1}]\nTitle: ${a.title}\nDescription: ${a.description}`)
      .join('\n\n')
    // 응답이 깨졌거나(JSON 오류·개수 불일치) 호출이 실패하면 같은 배치를 다시 요청해서 빈칸을 막는다.
    // (네트워크·429·5xx는 SDK가 자체적으로도 재시도한다)
    const MAX_ATTEMPTS = 3
    let best: ArticleAI[] | null = null // 시도마다 항목별로 가장 완전한 결과를 모아둔다
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const msg = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `You are a Korean tech news analyst. For each article below, return a JSON array with exactly ${batch.length} objects in order.

Each object must have:
- "topicEn": English translation of the Korean title (concise, natural)

Return ONLY the JSON array, no explanation.

${numbered}`,
          }],
        })
        const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
        const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()) as ArticleAI[]
        // 개수가 안 맞으면 영문 제목이 엉뚱한 기사 행에 붙으므로 실패로 보고 다시 시도한다.
        if (!Array.isArray(parsed) || parsed.length !== batch.length) {
          throw new Error(`응답 개수 불일치: 요청 ${batch.length}건 / 응답 ${Array.isArray(parsed) ? parsed.length : 'n/a'}건`)
        }
        // 항목 중 일부가 비어 있어도 이미 받은 완전한 항목은 유지하고, 빈 항목만 새 응답으로 채운다.
        best = best ? best.map((old, i) => (isCompleteAI(old) ? old : parsed[i])) : parsed
        const incomplete = best.filter(r => !isCompleteAI(r)).length
        if (incomplete === 0) return best
        throw new Error(`빈 항목 ${incomplete}건`)
      } catch (err) {
        console.warn(`[robot-csv] AI 응답 실패 [시도 ${attempt}/${MAX_ATTEMPTS}]:`, err instanceof Error ? err.message : err)
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
    if (best) {
      console.error(`[robot-csv] AI 응답 일부 항목 비어 있음(${MAX_ATTEMPTS}회 시도 후): "${batch[0]?.title?.slice(0, 30)}" 외`)
      return best
    }
    console.error(`[robot-csv] AI 응답 최종 실패 → ${batch.length}건 빈 값 처리 ("${batch[0]?.title?.slice(0, 30)}" 외)`)
    return batch.map(() => EMPTY_AI)
  }

  const results: ArticleAI[] = []
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = await Promise.all(batches.slice(i, i + CONCURRENCY).map(runBatch))
    results.push(...group.flat())
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
    .eq('key', LAST_DOWNLOAD_KEY)
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
    .eq('key', LAST_LINKS_KEY)
    .single()
  const prevLinks = new Set<string>(lastLinksData?.value?.links ?? [])

  const seen = new Set<string>()
  const articles: Article[] = []

  // 네이버 뉴스 검색 API만 사용 (구글/빙 RSS 제외)
  for (const keyword of ROBOT_KEYWORDS) {
    for (const sort of ['date', 'sim']) {
      try {
        // 띄어쓰기가 있는 키워드("피지컬 AI" 등)는 따옴표로 묶어 정확한 문구로 검색한다.
        // 그렇지 않으면 네이버가 단어별(AND)로 찾아 무관한 기사가 많이 섞인다.
        const q = encodeURIComponent(keyword.includes(' ') ? `"${keyword}"` : keyword)
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
          if (!res.ok) {
            console.warn(`[robot-csv] 네이버 API 오류 keyword=${keyword} sort=${sort} start=${start} status=${res.status}`)
            break
          }

          const data = await res.json() as {
            total: number
            items: Array<{ title: string; link: string; originallink: string; pubDate: string; description: string }>
          }

          const items = data.items ?? []
          if (items.length === 0) break

          // 이 페이지의 기사 중 가장 최신이 cutoff보다 오래됐으면 더 이상 볼 필요 없음
          const newest = items[0]?.pubDate ? new Date(items[0].pubDate) : null
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

            if (seen.has(link)) continue
            seen.add(link)

            articles.push({ title, link, pubDate: pub.toISOString(), description, keyword })
          }

          start += 100
        }
      } catch {
        // 키워드/정렬 오류 무시하고 계속
      }
    }
  }

  console.log(`[robot-csv] Naver 수집 완료: ${articles.length}건`)

  // debug=true 이면 수집 결과 JSON으로 반환 (AI/저장 없이 수집량 확인용)
  if (url.searchParams.get('debug') === 'true') {
    const byKeyword: Record<string, number> = {}
    for (const a of articles) byKeyword[a.keyword] = (byKeyword[a.keyword] ?? 0) + 1
    return NextResponse.json({
      total: articles.length,
      byKeyword,
      window: { start: cutoff.toISOString(), end: cutoffEnd.toISOString() },
      titles: articles.map(a => ({ date: a.pubDate.slice(0, 10), keyword: a.keyword, title: a.title })),
    })
  }

  // 최신순 정렬
  articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

  // 직전 다운로드에서 이미 내보낸 기사 제외 후, 도메인별 매체 정보 조회
  // (모르는 도메인은 'Unknown'으로 임시 등록 + 포함, status='excluded'인 도메인만 제외)
  const candidates = articles.filter(a => !prevLinks.has(a.link))
  const resolvedInfos = await Promise.all(candidates.map(a => resolveMedia(a.link)))
  // 매체+제목 기준 중복 제거 (같은 매체의 같은 기사만 제거, 다른 매체의 동일 제목은 별개 기사로 유지)
  const dedupSeen = new Set<string>()
  const filtered: { article: Article; info: MediaInfo }[] = []
  candidates.forEach((article, i) => {
    const info = resolvedInfos[i]
    if (!info) return
    const key = `${info.company}::${dedupKey(article.title)}`
    if (dedupSeen.has(key)) return
    dedupSeen.add(key)
    filtered.push({ article, info })
  })

  const yymmdd = getKstDateStr(now).replace(/-/g, '').slice(2)
  const filename = `${yymmdd}_Robot_articles.csv`

  const ai = process.env.ANTHROPIC_API_KEY
    ? await generateAIFields(filtered.map(f => f.article))
    : filtered.map(() => EMPTY_AI)

  // 컬럼 구성(요청 시트 양식, 화웨이 풀리스트와 다름): 일자 - 미디어명 - 기사 제목 - URL - 미디어타입 - 리마크
  // 일자 = 기사 발행일(KST, YYYY-MM-DD)
  // 리마크 = 한국어 제목 + 줄바꿈 + (공백 한 칸) 영문 제목 — 시트의 기존 행과 같은 모양
  const headers = ['일자', '미디어명', '기사 제목', 'URL', '미디어타입', '리마크']
  const rows = filtered.map(({ article: a, info: { company, mediaType } }, i) => {
    const r = ai[i] ?? EMPTY_AI
    const remarks = r.topicEn ? `${a.title}\n ${r.topicEn}` : a.title
    const date = new Date(a.pubDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    return toCsvRow([date, company, a.title, a.link, mediaType, remarks])
  })

  const csv = ['﻿' + toCsvRow(headers), ...rows].join('\n')

  // 마지막 다운로드 시점 + 이번에 내보낸 링크 저장 (다음 겹침 구간 중복 제거용)
  await supabase.from('configs').upsert({ key: LAST_DOWNLOAD_KEY, value: { timestamp: now.toISOString() } })
  await supabase.from('configs').upsert({ key: LAST_LINKS_KEY, value: { links: filtered.map(f => f.article.link) } })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
