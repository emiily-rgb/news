import Parser from 'rss-parser'
import { CategoryKeywords, ALLOWED_MEDIA } from '@/types'

const parser = new Parser({
  customFields: { item: ['source', 'description'] },
})

export interface RawArticle {
  title: string
  link: string
  pubDate: string
  media: string
  category: string
  keyword: string
  imageUrl?: string
}

function normalizeTitle(title: string): string {
  return title.replace(/[\s\W]/g, '').toLowerCase()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 허용 언론사 이름 목록 (source.name 매칭용)
const ALLOWED_MEDIA_NAMES = new Set(Object.values(ALLOWED_MEDIA))

// 추가 매칭용 별칭 (RSS source.name이 다르게 나올 수 있음)
const MEDIA_ALIASES: Record<string, string> = {
  '연합뉴스': '연합뉴스', 'Yonhap': '연합뉴스', 'Yonhap News': '연합뉴스',
  '조선일보': '조선일보', 'Chosun Ilbo': '조선일보', 'chosun': '조선일보',
  '중앙일보': '중앙일보', 'JoongAng Ilbo': '중앙일보', 'Korea JoongAng Daily': '중앙일보',
  '동아일보': '동아일보', 'Donga Ilbo': '동아일보',
  '한국경제': '한국경제', 'Korea Economic Daily': '한국경제', 'hankyung': '한국경제',
  '매일경제': '매일경제', 'MK': '매일경제', 'Maeil Business': '매일경제',
  '조선비즈': '조선비즈', 'ChosunBiz': '조선비즈',
  '머니투데이': '머니투데이', 'MoneyToday': '머니투데이', 'Money Today': '머니투데이',
  '전자신문': '전자신문', 'ETNews': '전자신문', 'Electronic Times': '전자신문',
  'ZDNet Korea': 'ZDNet Korea', 'ZDNet': 'ZDNet Korea', '지디넷코리아': 'ZDNet Korea', 'ZDNet 코리아': 'ZDNet Korea',
  '디지털데일리': '디지털데일리', 'Digital Daily': '디지털데일리',
  '아이뉴스24': '아이뉴스24', 'iNews24': '아이뉴스24', 'inews24': '아이뉴스24',
}

// 허용 언론사 체크 — source.name 우선, 없으면 URL 도메인
function getAllowedMedia(url: string, sourceName?: string): string | null {
  // 1. source.name으로 체크
  if (sourceName) {
    if (ALLOWED_MEDIA_NAMES.has(sourceName)) return sourceName
    const alias = MEDIA_ALIASES[sourceName]
    if (alias) return alias
    // 부분 매칭
    for (const name of ALLOWED_MEDIA_NAMES) {
      if (sourceName.includes(name) || name.includes(sourceName)) return name
    }
  }

  // 2. URL 도메인으로 체크 (구글 뉴스 URL이면 스킵)
  try {
    const host = new URL(url).hostname.toLowerCase().replace('www.', '')
    if (host.includes('news.google.com')) return null
    for (const [domain, name] of Object.entries(ALLOWED_MEDIA)) {
      if (host === domain || host.endsWith('.' + domain)) return name
    }
  } catch { /* ignore */ }

  return null
}

async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    clearTimeout(timeout)
    if (res.url.includes('news.google.com')) return undefined

    const html = await res.text()
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)

    const imgUrl = match?.[1]
    if (!imgUrl || imgUrl.startsWith('data:')) return undefined
    if (imgUrl.startsWith('/')) {
      const base = new URL(res.url)
      return `${base.protocol}//${base.host}${imgUrl}`
    }
    return imgUrl
  } catch {
    return undefined
  }
}

export async function collectArticles(
  categories: CategoryKeywords[],
  hoursBack: number
): Promise<RawArticle[]> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
  const seen = new Set<string>()
  const results: RawArticle[] = []

  for (const cat of categories) {
    for (const keyword of cat.keywords) {
      try {
        const encoded = encodeURIComponent(keyword)
        const url = `https://news.google.com/rss/search?q=${encoded}&hl=ko&gl=KR&ceid=KR:ko`
        const feed = await parser.parseURL(url)

        let count = 0
        for (const item of feed.items ?? []) {
          if (count >= 10) break
          if (!item.title || !item.link) continue

          // source가 문자열 또는 객체로 올 수 있음
          const rawSource = (item as any).source
          const sourceName = typeof rawSource === 'string' ? rawSource : (rawSource?.name ?? '')
          const mediaName = getAllowedMedia(item.link ?? '', sourceName)
          if (!mediaName) continue

          const pub = item.pubDate ? new Date(item.pubDate) : null
          if (!pub || pub < cutoff) continue

          const key = normalizeTitle(item.title)
          if (seen.has(key)) continue
          seen.add(key)

          const imageUrl = await fetchOgImage(item.link)
          results.push({
            title: item.title,
            link: item.link,
            pubDate: pub.toISOString(),
            media: mediaName,
            category: cat.category,
            keyword,
            imageUrl,
          })
          count++
        }

        await sleep(300)
      } catch (err) {
        console.error(`RSS 수집 실패 [${keyword}]:`, err)
      }
    }
  }

  return results
}
