import Parser from 'rss-parser'
import { CategoryKeywords } from '@/types'
import { ALLOWED_DOMAINS, SOURCE_NAME_MAP } from '@/lib/domains'
import { resolveMedia } from '@/lib/mediaResolver'

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
  description?: string
}

function normalizeTitle(title: string): string {
  return title.replace(/[\s\W]/g, '').toLowerCase()
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
  '통신장비', '네트워크 장비', '주파수 할당',
  // 통신사 시장 전반
  'SK텔레콤 AI', 'KT 통신', 'LG유플러스 네트워크',
  '이동통신 시장', '통신 정책', '5G SA', '5G 단독모드',
  'AI 팩토리', '피지컬 AI',
  // 6G / 차세대 네트워크
  '6G 기술', '6G ISAC', '차세대 네트워크', '오픈랜', 'IMT-2030', '6G 보안', '국제표준 6G',
  // Smart Campus / Smart Hospital
  '스마트 캠퍼스', '스마트 병원',
  '화웨이 스마트 캠퍼스', '화웨이 스마트 병원',
  // SSD / NAND
  '낸드플래시', 'SSD 시장',
  // Digital Power / Energy
  '디지털 파워', '데이터센터 전력',
  '화웨이 데이터센터',
  '썬그로우', 'Sungrow', '태양광 에너지', '화웨이 에너지', '루프 엔지니어링',
  '신재생에너지', 'ESS 배터리',
  // Smart Device
  '웨어러블 기기', '스마트워치',
  'HUAWEI Watch', '화웨이 밴드',
  // IAS
  '스마트카 반도체', '차량용 반도체',
  '화웨이 자율주행',
  // Talent Development
  '인재 육성', 'ICT 인재', 'SW 인재 양성', '화웨이 시드',
  // Policy
  '수출통제', '미국 제재', '반도체 규제', '삼성전자 반도체',
  '과기정통부', 'ICT 정책', '디지털 전략', '정보통신 정책',
  // 대중 장비 규제
  '중국 장비', '화웨이 장비 교체', '공급망 보안',
  // 반도체 경쟁
  '중국 반도체 기술', '메모리 반도체', 'DRAM 시장',
  // 중국 AI·첨단산업
  '중국 첨단산업', '중국 AI 산업', '중국 AI 굴기',
  // AI / 데이터센터 정책
  'AI 인프라', 'AI 국산화', '데이터센터 투자',
  // 한중 관계
  '한중 관계', '대중 외교', '중국 기업 규제',
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
  '화웨이 5G 장비', '통신장비 시장', '네트워크 장비 교체',
  // 통신사 시장 전반
  'SKT AI 서비스', 'KT 네트워크 전략', 'LG유플러스 6G',
  '이동통신 정책', '5G 단독모드', 'AI 팩토리 구축', '피지컬 AI 인프라',
  // 6G / 차세대 네트워크
  '6G ISAC 기술', '차세대 네트워크 한국', '오픈랜 구축', 'IMT-2030 표준', '6G 보안 표준',
  // Smart Campus / Smart Hospital
  '스마트 캠퍼스', '스마트 병원',
  '화웨이 스마트 캠퍼스', '화웨이 스마트 병원',
  // SSD / NAND
  'SSD 낸드', '낸드플래시 시장',
  // Digital Power / Energy
  '데이터센터 전력 효율',
  '화웨이 전력 솔루션',
  '썬그로우', '태양광 발전', '화웨이 에너지', '루프 엔지니어링', 'ESS 시장',
  // Smart Device
  '웨어러블', '스마트워치 시장',
  '화웨이 워치', '화웨이 밴드',
  // IAS
  '자율주행 반도체',
  '화웨이 차량용',
  // Talent Development
  '인재 육성 프로그램', 'ICT 인재 양성', 'SW 인재', '화웨이 시드 프로그램',
  // Policy
  '반도체 정책', '대중국 규제', 'AI 정책', '반도체 공급망',
  '과기정통부 정책', 'ICT 정책', '정보통신 전략', '디지털 정책',
  // 대중 장비 규제
  '중국 통신장비 규제', '나토 중국 장비', '공급망 보안 정책',
  // 반도체 경쟁
  '중국 반도체 굴기', 'DRAM 경쟁', '메모리 반도체 시장',
  // 중국 AI·첨단산업
  '중국 첨단산업', '중국 AI 산업',
  // AI / 데이터센터 정책
  'AI 인프라 투자', 'AI 국산화 정책', '데이터센터 구축',
  // 한중 관계
  '한중 경제 관계', '중국 기업 제재', '대중 외교 정책',
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
        if (!media) media = (await resolveMedia(item.link))?.company ?? null
        if (!media) continue

        const pub = item.pubDate ? new Date(item.pubDate) : null
        if (!pub || pub < cutoff) continue

        // 제목 끝 매체명 제거: "제목 - 매체명", "제목 | 매체명", "제목 (매체명)", "제목 [매체명]"
        const candidates = [media, sourceName, ...Object.keys(SOURCE_NAME_MAP).filter(k => SOURCE_NAME_MAP[k] === media)]
        let cleanTitle = item.title
        for (const name of candidates) {
          if (!name) continue
          cleanTitle = cleanTitle
            .replace(new RegExp(`\\s*[-|]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
            .replace(new RegExp(`\\s*[\\(\\[]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\)\\]]\\s*$`, 'i'), '')
            .trim()
        }

        const key = normalizeTitle(cleanTitle)
        if (seen.has(key)) continue
        seen.add(key)

        // 카테고리 매칭
        const titleLower = cleanTitle.toLowerCase()
        const matched = allKeywords.find(k => titleLower.includes(k.lower))
        const category = matched?.category ?? '업계'
        const kw = matched?.keyword ?? keyword

        const desc = (item as any).description ?? ''
        const cleanDesc = typeof desc === 'string'
          ? desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
          : ''

        articles.push({ title: cleanTitle, link: item.link, pubDate: pub.toISOString(), media, category, keyword: kw, description: cleanDesc })
      }
    } catch { /* ignore */ }
    return articles
  }

  async function searchBing(keyword: string): Promise<RawArticle[]> {
    const articles: RawArticle[] = []
    try {
      const q = encodeURIComponent(keyword)
      const url = `https://www.bing.com/news/search?q=${q}&format=rss`
      const feed = await Promise.race([
        parser.parseURL(url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]) as Awaited<ReturnType<typeof parser.parseURL>>

      for (const item of feed.items?.slice(0, 50) ?? []) {
        if (!item.title || !item.link) continue

        // Bing 링크에서 실제 URL 추출
        let realLink = item.link
        try {
          const match = item.link.match(/[?&]url=([^&]+)/)
          if (match) realLink = decodeURIComponent(match[1])
        } catch { /* ignore */ }

        const media = getMediaFromUrl(realLink) ?? (await resolveMedia(realLink))?.company ?? null
        if (!media) continue

        const pub = item.pubDate ? new Date(item.pubDate) : null
        if (!pub || pub < cutoff) continue

        // 제목 끝 매체명 제거
        let cleanTitle = item.title
        for (const name of [media]) {
          if (!name) continue
          cleanTitle = cleanTitle
            .replace(new RegExp(`\\s*[-|]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
            .replace(new RegExp(`\\s*[\\(\\[]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\)\\]]\\s*$`, 'i'), '')
            .trim()
        }

        const key = normalizeTitle(cleanTitle)
        if (seen.has(key)) continue
        seen.add(key)

        const desc = (item as any).description ?? item.contentSnippet ?? ''
        const cleanDesc = typeof desc === 'string'
          ? desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
          : ''

        const titleLower = cleanTitle.toLowerCase()
        const matched = allKeywords.find(k => titleLower.includes(k.lower))
        const category = matched?.category ?? '업계'
        const kw = matched?.keyword ?? keyword

        articles.push({ title: cleanTitle, link: realLink, pubDate: pub.toISOString(), media, category, keyword: kw, description: cleanDesc })
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

        const media = getMediaFromUrl(link) ?? (await resolveMedia(link))?.company ?? null
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

        const cleanDesc = item.description
          ? item.description.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
          : ''

        articles.push({ title, link, pubDate: pub.toISOString(), media, category, keyword: kw, description: cleanDesc })
      }
    } catch { /* ignore */ }
    return articles
  }

  // 구글: 5개씩 묶어 순차 실행 (rate limit 방지)
  const GOOGLE_BATCH = 5
  const googleResults: RawArticle[] = []
  for (let i = 0; i < SEARCH_KEYWORDS.length; i += GOOGLE_BATCH) {
    const batch = SEARCH_KEYWORDS.slice(i, i + GOOGLE_BATCH)
    const batchResults = await Promise.all(batch.map(kw => searchGoogle(kw)))
    googleResults.push(...batchResults.flat())
  }

  // Bing: 화웨이 전용 키워드만 (자사 기사 보강 목적)
  const BING_KEYWORDS = ['화웨이', 'Huawei']
  const bingResults = await Promise.all(BING_KEYWORDS.map(kw => searchBing(kw)))

  const naverResults = await Promise.all(NAVER_SEARCH_KEYWORDS.map(kw => searchNaver(kw)))
  return [...googleResults, ...bingResults.flat(), ...naverResults.flat()]
}
