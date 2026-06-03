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

// 직접 구독 가능한 RSS 피드
const DIRECT_FEEDS: { url: string; name: string }[] = [
  { url: 'https://www.yna.co.kr/rss/news.xml',           name: '연합뉴스' },
  { url: 'https://rss.donga.com/total.xml',              name: '동아일보' },
  { url: 'https://www.hankyung.com/feed/all-news',       name: '한국경제' },
  { url: 'https://www.mk.co.kr/rss/40300001/',           name: '매일경제' },
  { url: 'https://rss.mt.co.kr/mt_news.xml',            name: '머니투데이' },
  { url: 'https://rss.etnews.com/Section901.xml',        name: '전자신문' },
  { url: 'https://rss.etnews.com/Section902.xml',        name: '전자신문' },
]

// RSS 없는 언론사 — Google News 사이트 검색 (핵심 키워드만)
const GOOGLE_SITE_FEEDS: { site: string; name: string }[] = [
  { site: 'chosun.com',    name: '조선일보' },
  { site: 'joongang.co.kr', name: '중앙일보' },
  { site: 'biz.chosun.com', name: '조선비즈' },
  { site: 'zdnet.co.kr',   name: 'ZDNet Korea' },
  { site: 'ddaily.co.kr',  name: '디지털데일리' },
  { site: 'inews24.com',   name: '아이뉴스24' },
]
const GOOGLE_SITE_KEYWORDS = ['화웨이', 'Huawei', 'AI 반도체', '수출통제', '미국 제재']

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

  function matchKeyword(title: string): { category: string; keyword: string } | null {
    const lower = title.toLowerCase()
    return allKeywords.find(k => lower.includes(k.lower)) ?? null
  }

  function addArticle(articles: RawArticle[], item: { title: string; link: string; pubDate: string }, media: string) {
    const matched = matchKeyword(item.title)
    if (!matched) return
    const key = normalizeTitle(item.title)
    if (seen.has(key)) return
    seen.add(key)
    articles.push({ title: item.title, link: item.link, pubDate: item.pubDate, media, category: matched.category, keyword: matched.keyword })
  }

  // 1. 직접 RSS 피드 병렬 수집
  const directResults = await Promise.all(
    DIRECT_FEEDS.map(async ({ url, name }) => {
      const articles: RawArticle[] = []
      try {
        const feed = await parser.parseURL(url)
        for (const item of feed.items ?? []) {
          if (!item.title || !item.link) continue
          const pub = item.pubDate ? new Date(item.pubDate) : null
          if (!pub || pub < cutoff) continue
          addArticle(articles, { title: item.title, link: item.link, pubDate: pub.toISOString() }, name)
        }
      } catch (err) {
        console.error(`RSS 수집 실패 [${name}]:`, err)
      }
      return articles
    })
  )

  // 2. Google News 사이트별 검색 (RSS 없는 언론사용, 핵심 키워드만)
  const googleResults = await Promise.all(
    GOOGLE_SITE_FEEDS.flatMap(({ site, name }) =>
      GOOGLE_SITE_KEYWORDS.map(async (kw) => {
        const articles: RawArticle[] = []
        try {
          const q = encodeURIComponent(`${kw} site:${site}`)
          const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`
          const feed = await parser.parseURL(url)
          for (const item of (feed.items ?? []).slice(0, 5)) {
            if (!item.title || !item.link) continue
            const pub = item.pubDate ? new Date(item.pubDate) : null
            if (!pub || pub < cutoff) continue
            addArticle(articles, { title: item.title, link: item.link, pubDate: pub.toISOString() }, name)
          }
        } catch { /* ignore */ }
        return articles
      })
    )
  )

  return [...directResults.flat(), ...googleResults.flat()]
}
