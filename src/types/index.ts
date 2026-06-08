export type Role = 'admin' | 'content_manager'

export type Sentiment = 'positive' | 'negative' | 'neutral'
export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type ArticleTag =
  | 'AI' | 'Cloud' | 'Network' | 'Smartphone'
  | 'Policy' | 'US Sanctions' | 'China' | 'Data Center' | 'Investment'
  | 'AI Semiconductor' | 'Smart Campus' | 'Smart Hospital' | 'SSD' | 'Digital Power' | 'Smart Device' | 'IAS'

// 업계(行业资讯) 내 태그 정렬 순서
export const INDUSTRY_TAG_ORDER: ArticleTag[] = [
  'Network',
  'AI Semiconductor',
  'Smart Campus',
  'Smart Hospital',
  'SSD',
  'Digital Power',
  'Smart Device',
  'IAS',
]

export interface Article {
  id: string
  run_id: string
  category: string       // '자사' | '업계' | '정책'
  keyword: string
  title: string
  title_zh: string | null
  media: string
  media_tier: number
  link: string
  pub_date: string
  summary_ko: string[]
  summary_zh: string[]
  sentiment: Sentiment
  relevance_score: number
  image_url: string | null
  tag: ArticleTag | null
  impact_level: ImpactLevel
  why_it_matters_ko: string | null
  why_it_matters_zh: string | null
  order_index: number | null
  excluded: boolean
  excluded_by: string | null
  excluded_at: string | null
  collected_at: string
  is_manual: boolean | null
}

export interface EmergingSignals {
  positive: string[]
  risk: string[]
  positive_zh?: string[]
  risk_zh?: string[]
}

export interface RunLog {
  id: string
  run_at: string
  run_by: string
  status: 'running' | 'completed' | 'failed'
  total_collected: number
  total_after_filter: number
  insight_ko: string[]        // Executive Summary (KR)
  insight_zh: string[]        // Executive Summary (CN)
  key_takeaways: string[]
  emerging_signals: EmergingSignals | null
  tomorrow_watchlist: string[]
  insight_generated_at: string | null
  draft_saved_at: string | null
  sent_at: string | null
  sent_by: string | null
  recipients: string[]
  error: string | null
}

export interface Config {
  keywords: CategoryKeywords[]
  recipients: string[]
  collection_hours: number
  schedule_morning: string
  schedule_evening: string
  media_tiers: Record<string, number>
  media_display: Record<string, string>
}

export interface CategoryKeywords {
  category: string
  keywords: string[]
}

// 허용 언론사 및 도메인
export const ALLOWED_MEDIA: Record<string, string> = {
  // 종합지
  'yna.co.kr': '연합뉴스',
  'chosun.com': '조선일보',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  // 경제지
  'hankyung.com': '한국경제',
  'mk.co.kr': '매일경제',
  'biz.chosun.com': '조선비즈',
  'mt.co.kr': '머니투데이',
  // IT/산업 전문지
  'etnews.com': '전자신문',
  'zdnet.co.kr': 'ZDNet Korea',
  'ddaily.co.kr': '디지털데일리',
  'inews24.com': '아이뉴스24',
}

// 매체명 한글 → 영문 변환
export const MEDIA_DISPLAY: Record<string, string> = {
  '연합뉴스': 'Yonhap News',
  '조선일보': 'Chosun Ilbo',
  '중앙일보': 'JoongAng Ilbo',
  '동아일보': 'Donga Ilbo',
  '한국경제': 'Korea Economic Daily',
  '매일경제': 'Maeil Business News',
  '조선비즈': 'ChosunBiz',
  '머니투데이': 'Money Today',
  '전자신문': 'Electronic Times',
  'ZDNet Korea': 'ZDNet Korea',
  '디지털데일리': 'Digital Daily',
  '아이뉴스24': 'iNews24',
  '서울경제': 'Seoul Economic Daily',
  '연합뉴스TV': 'Yonhap News TV',
  'IT조선': 'IT Chosun',
  'AI타임스': 'AI Times',
  '블로터': 'Bloter',
  'YTN': 'YTN',
  '이데일리': 'Edaily',
  '한국일보': 'Hankook Ilbo',
  '뉴스1': 'News1',
  '헤럴드경제': 'Herald Economy',
  '비즈니스포스트': 'BusinessPost',
  '더구루': 'The Guru',
  '더스쿠프': 'The Scoop',
  '아주경제': 'Aju Business Daily',
  '글로벌이코노믹': 'Global Economic',
}

export function formatMediaName(media: string, overrides?: Record<string, string>): string {
  return overrides?.[media] ?? MEDIA_DISPLAY[media] ?? media
}

export const DEFAULT_CONFIG: Config = {
  keywords: [
    // Huawei
    { category: '자사', keywords: ['화웨이', 'Huawei', '화웨이 AI', 'Huawei Cloud', '화웨이 Ascend'] },
    // Industry
    { category: '업계', keywords: [
      // AI Semiconductor
      'AI 반도체', 'AI 서버', 'NPU', 'AI 칩', '엔비디아', 'NVIDIA', '삼성전자 반도체', 'SK하이닉스',
      // Network
      '5G', '6G', '주파수', 'LGU+', '네트워크 장비',
      // Smart Campus / Smart Hospital
      '스마트 캠퍼스', '스마트 병원', '스마트 솔루션',
      // SSD / NAND
      'SSD', '낸드플래시', 'NAND',
      // Digital Power
      '디지털 파워', '데이터센터 전력',
      // Smart Device
      '웨어러블', '스마트워치',
      // IAS
      '스마트카', '차량용 반도체', '자율주행',
      // General
      'AI 데이터센터',
    ] },
    // Policy
    { category: '정책', keywords: ['미국 반도체 규제', '수출통제', 'AI 정책', '반도체 정책', '대중국 규제'] },
  ],
  recipients: [],
  collection_hours: 24,
  schedule_morning: '08:00',
  schedule_evening: '17:00',
  media_tiers: {
    '조선일보': 1, '중앙일보': 1, '동아일보': 1, '연합뉴스': 1,
    '한국경제': 2, '매일경제': 2, '조선비즈': 2, '머니투데이': 2,
    '전자신문': 2, 'ZDNet Korea': 2, '디지털데일리': 2, '아이뉴스24': 2,
    '이데일리': 2, '한국일보': 2, '뉴스1': 2, '헤럴드경제': 2,
    '서울경제': 2, 'YTN': 2,
    '비즈니스포스트': 3, '더구루': 3, '더스쿠프': 3,
    '블로터': 3, 'AI타임스': 3, 'IT조선': 3,
  },
  media_display: {},
}
