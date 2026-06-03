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
  '화웨이', 'Huawei', 'AI 반도체', '수출통제', '미국 제재',
  '엔비디아', 'HBM', '5G', 'AI 서버', '반도체 규제',
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

  // 키워드별 Google News 병렬 검색
  const results = await Promise.all(SEARCH_KEYWORDS.map(kw => searchGoogle(kw)))
  return results.flat()
}
