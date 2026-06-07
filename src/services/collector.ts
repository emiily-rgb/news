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
  'sedaily.com': '서울경제',
  'aitimes.com': 'AI타임스',
  'bloter.net': '블로터',
  'itchosun.com': 'IT조선',
  'ytn.co.kr': 'YTN',
  'edaily.co.kr': '이데일리',
  'hankookilbo.com': '한국일보',
  'news1.kr': '뉴스1',
  'heraldcorp.com': '헤럴드경제',
  'businesspost.co.kr': '비즈니스포스트',
  'theguru.co.kr': '더구루',
  'thescoop.co.kr': '더스쿠프',
}

// Google News source.name → 내부 언론사명 매핑 (한글 이름과 다를 경우)
const SOURCE_NAME_MAP: Record<string, string> = {
  'Yonhap News Agency': '연합뉴스',
  'Yonhap': '연합뉴스',
  'The Chosun Ilbo': '조선일보',
  'JoongAng Ilbo': '중앙일보',
  'Donga': '동아일보',
  'Korea Economic Daily': '한국경제',
  'Maeil Business Newspaper': '매일경제',
  'ChosunBiz': '조선비즈',
  'Money Today': '머니투데이',
  'Electronic Times': '전자신문',
  'ZDNet Korea': 'ZDNet Korea',
  'Digital Daily': '디지털데일리',
  'iNews24': '아이뉴스24',
  'Seoul Economic Daily': '서울경제',
  'AI Times': 'AI타임스',
  'Bloter': '블로터',
  'IT Chosun': 'IT조선',
  'Edaily': '이데일리',
  'The Korea Herald': '헤럴드경제',
  'News1': '뉴스1',
  'Hankook Ilbo': '한국일보',
  'BusinessPost': '비즈니스포스트',
  'The Guru': '더구루',
  'The Scoop': '더스쿠프',
}

// Google News 검색 키워드 (핵심만, 병렬 처리)
const SEARCH_KEYWORDS = [
  // Huawei
  'Huawei', '화웨이',
  // AI Semiconductor
  'AI 반도체', 'AI 서버', '엔비디아', 'HBM', 'NPU 반도체', 'AI 칩',
  'Huawei Ascend', '화웨이 AI 반도체',
  // Network
  '5G 주파수', '6G 통신', 'LGU+ 5G',
  'Huawei 5G', '화웨이 네트워크',
  // Smart Campus / Smart Hospital
  '스마트 캠퍼스', '스마트 병원',
  '화웨이 스마트 캠퍼스', '화웨이 스마트 병원',
  // SSD / NAND
  '낸드플래시', 'SSD 시장',
  // Digital Power
  '디지털 파워', '데이터센터 전력',
  '화웨이 데이터센터',
  // Smart Device
  '웨어러블 기기', '스마트워치',
  'HUAWEI Watch', '화웨이 밴드',
  // IAS
  '스마트카 반도체', '차량용 반도체',
  '화웨이 자율주행',
  // Policy
  '수출통제', '미국 제재', '반도체 규제', '삼성전자 반도체',
]

// 네이버 뉴스 검색 키워드 (합친 키워드로 요청 수 줄임)
const NAVER_SEARCH_KEYWORDS = [
  // Huawei
  '화웨이 Ascend', 'Huawei Cloud', '화웨이 AI', '화웨이',
  '화웨이 클라우드매트릭스',
  // AI Semiconductor
  'SK하이닉스', 'AI 데이터센터', 'AI NPU',
  '화웨이 AI 서버',
  // Network
  '주파수 할당', 'LGU+ 네트워크', '6G 이동통신',
  '화웨이 5G 장비',
  // Smart Campus / Smart Hospital
  '스마트 캠퍼스', '스마트 병원',
  '화웨이 스마트 캠퍼스', '화웨이 스마트 병원',
  // SSD / NAND
  'SSD 낸드', '낸드플래시 시장',
  // Digital Power
  '데이터센터 전력 효율',
  '화웨이 전력 솔루션',
  // Smart Device
  '웨어러블', '스마트워치 시장',
  '화웨이 워치', '화웨이 밴드',
  // IAS
  '자율주행 반도체',
  '화웨이 차량용',
  // Policy
  '반도체 정책', '대중국 규제', 'AI 정책', '반도체 공급망',
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

      for (const item of feed.items?.slice(0, 50) ?? []) {
        if (!item.title || !item.link) continue

        // 허용 언론사 확인 (source.name 또는 URL)
        const rawSource = (item as any).source
        const sourceName = typeof rawSource === 'string' ? rawSource : (rawSource?.name ?? '')
        let media = getMediaFromUrl(item.link)
        if (!media) {
          // SOURCE_NAME_MAP 직접 매핑 먼저
          media = SOURCE_NAME_MAP[sourceName] ?? null
        }
        if (!media) {
          // 부분 매칭 fallback
          for (const [eng, kor] of Object.entries(SOURCE_NAME_MAP)) {
            if (sourceName.includes(eng) || eng.includes(sourceName)) { media = kor; break }
          }
        }
        if (!media) {
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
      const url = `https://openapi.naver.com/v1/search/news.json?query=${q}&display=100&sort=date`
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

  // 구글: 5개씩 묶어 순차 실행 (rate limit 방지) + 네이버: 병렬
  const GOOGLE_BATCH = 5
  const googleResults: RawArticle[] = []
  for (let i = 0; i < SEARCH_KEYWORDS.length; i += GOOGLE_BATCH) {
    const batch = SEARCH_KEYWORDS.slice(i, i + GOOGLE_BATCH)
    const batchResults = await Promise.all(batch.map(kw => searchGoogle(kw)))
    googleResults.push(...batchResults.flat())
  }

  const naverResults = await Promise.all(NAVER_SEARCH_KEYWORDS.map(kw => searchNaver(kw)))
  return [...googleResults, ...naverResults.flat()]
}
