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

// 언론사 직접 RSS 피드
const MEDIA_FEEDS: { url: string; name: string }[] = [
  { url: 'https://www.yna.co.kr/rss/news.xml',                        name: '연합뉴스' },
  { url: 'https://www.chosun.com/arc/outboundfeeds/rss/',             name: '조선일보' },
  { url: 'https://rss.joins.com/joins_news_list.xml',                 name: '중앙일보' },
  { url: 'https://rss.donga.com/total.xml',                           name: '동아일보' },
  { url: 'https://www.hankyung.com/feed/all-news',                    name: '한국경제' },
  { url: 'https://www.mk.co.kr/rss/40300001/',                        name: '매일경제' },
  { url: 'https://biz.chosun.com/arc/outboundfeeds/rss/',             name: '조선비즈' },
  { url: 'https://rss.mt.co.kr/mt_news.xml',                         name: '머니투데이' },
  { url: 'https://rss.etnews.com/Section901.xml',                     name: '전자신문' },
  { url: 'https://rss.etnews.com/Section902.xml',                     name: '전자신문' },
  { url: 'https://www.zdnet.co.kr/rss/news.xml',                      name: 'ZDNet Korea' },
  { url: 'https://www.ddaily.co.kr/rss/allArticle.xml',               name: '디지털데일리' },
  { url: 'https://inews24.com/rss/allnews.xml',                       name: '아이뉴스24' },
]

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

  // 모든 피드 병렬 수집
  const feedResults = await Promise.all(
    MEDIA_FEEDS.map(async ({ url, name }) => {
      const articles: RawArticle[] = []
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const feed = await parser.parseURL(url)
        clearTimeout(timeout)

        for (const item of feed.items ?? []) {
          if (!item.title || !item.link) continue
          const pub = item.pubDate ? new Date(item.pubDate) : null
          if (!pub || pub < cutoff) continue

          const titleLower = item.title.toLowerCase()
          const matched = allKeywords.find(k => titleLower.includes(k.lower))
          if (!matched) continue

          const key = normalizeTitle(item.title)
          if (seen.has(key)) continue
          seen.add(key)

          articles.push({
            title: item.title,
            link: item.link,
            pubDate: pub.toISOString(),
            media: name,
            category: matched.category,
            keyword: matched.keyword,
          })
        }
      } catch (err) {
        console.error(`RSS 수집 실패 [${name} / ${url}]:`, err)
      }
      return articles
    })
  )

  return feedResults.flat()
}
