import Parser from 'rss-parser'
import { CategoryKeywords } from '@/types'

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

// 허용 언론사 도메인
const ALLOWED_DOMAINS: Record<string, string> = {
  'yna.co.kr': '연합뉴스',
  'chosun.com': '조선일보',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  'hankyung.com': '한국경제',
  'mk.co.kr': '매일경제',
  'biz.chosun.com': '조선비즈',
  'mt.co.kr': '머니투데이',
  'etnews.com': '전자신문',
  'zdnet.co.kr': 'ZDNet Korea',
  'ddaily.co.kr': '디지털데일리',
  'inews24.com': '아이뉴스24',
}

// Google News 검색 키워드 (핵심만, 병렬 처리)
const SEARCH_KEYWORDS = [
  'Huawei', 'AI 반도체', '수출통제', '미국 제재',
  '엔비디아', 'HBM', '5G', 'AI 서버', '반도체 규제', '삼성전자 반도체',
]

// 네이버 뉴스 검색 키워드 (합친 키워드로 요청 수 줄임)
const NAVER_SEARCH_KEYWORDS = [
  '화웨이 Ascend',
  'Huawei Cloud',
  '화웨이 AI',
  '화웨이',
  'SK하이닉스',
  'AI 데이터센터',
  '반도체 정책',
  '대중국 규제',
  'AI 정책',
  '반도체 공급망',
]

function getMediaFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace('www.', '')
    for (const [domain, name] of Object.entries(ALLOWED_DOMAINS)) {
      if (host === domain || host.endsWith('.' + domain)) return name
    }
  } catch { /* ignore */ }
  return null
}

export async function collectArticles(
  categories: CategoryKeywords[],
  hoursBack: number
): Promise<RawArticle[]> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
  const seen = new Set<string>()

  // 키워드 평탄화 (소문자)
  const allKeywords = categories.flatMap(cat =>
    cat.keywords.map(kw => ({ category: cat.category, keyword: kw, lower: kw.toLowerCase() }))
  )

  async function searchGoogle(keyword: string): Promise<RawArticle[]> {
    const articles: RawArticle[] = []
    try {
      const q = encodeURIComponent(keyword)
      const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`
      const feed = await Promise.race([
        parser.parseURL(url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]) as Awaited<ReturnType<typeof parser.parseURL>>

      for (const item of feed.items?.slice(0, 20) ?? []) {
        if (!item.title || !item.link) continue

        // 허용 언론사 확인 (source.name 또는 URL)
        const rawSource = (item as any).source
        const sourceName = typeof rawSource === 'string' ? rawSource : (rawSource?.name ?? '')
        let media = getMediaFromUrl(item.link)
        if (!media) {
          // source.name으로 매칭 시도
          for (const name of Object.values(ALLOWED_DOMAINS)) {
            if (sourceName.includes(name) || name.includes(sourceName)) { media = name; break }
          }
        }
        if (!media) continue

        const pub = item.pubDate ? new Date(item.pubDate) : null
        if (!pub || pub < cutoff) continue

        const key = normalizeTitle(item.title)
        if (seen.has(key)) continue
        seen.add(key)

        // 카테고리 매칭
        const titleLower = item.title.toLowerCase()
        const matched = allKeywords.find(k => titleLower.includes(k.lower))
        const category = matched?.category ?? '업계'
        const kw = matched?.keyword ?? keyword

        articles.push({ title: item.title, link: item.link, pubDate: pub.toISOString(), media, category, keyword: kw })
      }
    } catch { /* ignore */ }
    return articles
  }

  async function searchNaver(keyword: string): Promise<RawArticle[]> {
    const clientId = process.env.NAVER_CLIENT_ID
    const clientSecret = process.env.NAVER_CLIENT_SECRET
    if (!clientId || !clientSecret) return []

    const articles: RawArticle[] = []
    try {
      const q = encodeURIComponent(keyword)
      const url = `https://openapi.naver.com/v1/search/news.json?query=${q}&display=50&sort=date`
      const res = await Promise.race([
        fetch(url, {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]) as Response

      if (!res.ok) return []
      const data = await res.json() as { items: Array<{ title: string; link: string; originallink: string; pubDate: string; description: string }> }

      for (const item of data.items ?? []) {
        const link = item.originallink || item.link
        if (!link) continue

        const media = getMediaFromUrl(link)
        if (!media) continue

        const pub = item.pubDate ? new Date(item.pubDate) : null
        if (!pub || pub < cutoff) continue

        const title = item.title.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
        const key = normalizeTitle(title)
        if (seen.has(key)) continue
        seen.add(key)

        const titleLower = title.toLowerCase()
        const matched = allKeywords.find(k => titleLower.includes(k.lower))
        const category = matched?.category ?? '업계'
        const kw = matched?.keyword ?? keyword

        articles.push({ title, link, pubDate: pub.toISOString(), media, category, keyword: kw })
      }
    } catch { /* ignore */ }
    return articles
  }

  // 구글 + 네이버 병렬 검색
  const [googleResults, naverResults] = await Promise.all([
    Promise.all(SEARCH_KEYWORDS.map(kw => searchGoogle(kw))),
    Promise.all(NAVER_SEARCH_KEYWORDS.map(kw => searchNaver(kw))),
  ])
  return [...googleResults.flat(), ...naverResults.flat()]
}
