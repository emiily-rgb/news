// 로봇 풀리스트 수집 기준 1단계: 검색 키워드 + "제목" 기준 포함·제외 조건.
// (기업 구분/매칭 키워드 표기, 본문 의미 판단, 유사 기사 묶기는 이 모듈의 범위가 아니다.)

// 1. 무조건 수집 — 검색에 걸렸으면 제목·본문 어디든 언급된 것으로 보고 유지한다 (본문은 볼 수 없음)
const OWN_NAMES = [
  '화인로보틱스', '애지봇', '유니트리', '유비테크', '갤봇', '아이엘로보틱스', '뉴로메카', '로브로스',
  '메크마인드', '씨메스', '에브리봇', '마음AI', '페르소나AI', '탑로보틱스', '왓츠랩', '스완로보틱스',
  '인피니트몽키즈', '서큘러스', '로보틱박스', '빅웨이브로보틱스',
]

// 2. 로봇 관련어가 함께 있을 때만 수집 (제목 기준)
const CONDITIONAL_NAMES = ['아이엘', '빅웨이브', 'XYZ', '엑스와이지', 'ROAS', '리얼월드', '한세모빌리티', '동희산업', '한국수력원자력']

// 3. 제목에 로봇 관련어가 있을 때만 수집 — 그룹/연구기관/글로벌 휴머노이드 기업
const GROUP_NAMES = ['삼성', 'LG', '엘지', '현대', 'SK', 'LS', '한국기계연구원', 'KIST', '카이스트']
const GLOBAL_HUMANOID_NAMES = ['옵티머스', '피겨', '보스턴다이내믹스']

// 로봇 관련어 / 그중 광의어(제목에 있으면 그것만으로 수집)
const ROBOT_WORDS = ['로봇', '로보틱스', '휴머노이드', '피지컬 AI', '피지컬AI', '로봇 핸드', '로봇 데이터', '협동로봇']
const BROAD_WORDS = ['로보틱스', '피지컬 AI', '피지컬AI', '휴머노이드', '로봇 핸드', '로봇 데이터']

// 4. 제외 단어 (제목). 1번 기업명이 제목에 있으면 유지한다.
// '인사'(인사이트·인사하는 로봇), '총수'(총수요)는 오탐이 많아 패턴으로 따로 처리한다.
// 특징주~공매도는 요청자 목록에 없던 증권성 단어를 담당자 결정으로 추가한 것 (2026-10-30)
const EXCLUDE_WORDS = [
  '주가', '목표가', '급등', '급락', 'ETF', '시황', '애프터마켓', '종목', '코인', '가상자산',
  '승계', '경영철학', '주주총회', '지배구조', '중복상장',
  '특징주', '상한가', '하한가', '증시', '투자의견', '순매수', '테마주', '공매도',
]
const EXCLUDE_PATTERNS = [
  /인사(?!이트|이드|하|말|를 나)/,
  /총수(?!요)/,
  /코스(?:피|닥)(?!\s?상장)/, // 코스닥 상장 소식은 유지
  /(?<!(?:접수|신청|모집)\s?)마감/, // 접수·신청·모집 마감은 유지
]

// 영문 토큰은 앞이 영문자이면 다른 단어의 일부로 본다 (ELS ≠ LS, ASK ≠ SK)
function has(text: string, word: string): boolean {
  if (/^[A-Za-z0-9]+$/.test(word)) return new RegExp(`(?<![A-Za-z])${word}`).test(text)
  return text.includes(word)
}

const hasAny = (text: string, words: string[]) => words.some(w => has(text, w))

// 네이버가 "마음 AI"처럼 띄어 검색해 무관한 기사가 대량으로 걸리는 이름 — 제목·요약문에 실제로 있어야 1번 기업 검색 결과로 인정한다
const AMBIGUOUS_OWN_NAMES = ['마음AI', '페르소나AI']

export function confirmOwnHit(keyword: string, title: string, description: string): boolean {
  if (!AMBIGUOUS_OWN_NAMES.includes(keyword)) return true
  return `${title} ${description}`.replace(/\s+/g, '').includes(keyword)
}

export type SearchKeyword ={ keyword: string; query: string; own: boolean }

// 네이버 검색 쿼리. 띄어쓰기 키워드는 정확한 문구로, "이름 로봇" 조합은 AND 검색으로 보낸다.
export function buildSearchKeywords(): SearchKeyword[] {
  const exact = (k: string) => (k.includes(' ') ? `"${k}"` : k)
  return [
    ...OWN_NAMES.map(k => ({ keyword: k, query: exact(k), own: true })),
    ...BROAD_WORDS.filter(k => k !== '피지컬AI').map(k => ({ keyword: k, query: exact(k), own: false })),
    ...[...CONDITIONAL_NAMES, ...GROUP_NAMES, ...GLOBAL_HUMANOID_NAMES]
      .filter(k => k !== '엑스와이지') // XYZ와 함께 쓰이는 표기라 별도 검색은 생략
      .map(k => ({ keyword: k, query: `${k} 로봇`, own: false })),
  ]
}

export type Verdict = { keep: boolean; reason: string }

/**
 * 제목 기준 판단. matchedOwn = 1번 기업명 검색으로 찾은 기사(제목에 없어도 본문 언급으로 간주).
 * 제외 단어는 1번 기업명이 제목에 있을 때만 예외다.
 */
export function judgeTitle(title: string, matchedOwn: boolean): Verdict {
  const ownInTitle = hasAny(title, OWN_NAMES)
  const excluded = hasAny(title, EXCLUDE_WORDS) || EXCLUDE_PATTERNS.some(p => p.test(title))
  if (excluded && !ownInTitle) return { keep: false, reason: '제외 단어' }

  if (ownInTitle || matchedOwn) return { keep: true, reason: '1번 기업' }

  const robot = hasAny(title, ROBOT_WORDS)
  if (hasAny(title, BROAD_WORDS)) return { keep: true, reason: '광의어' }
  if (robot && hasAny(title, [...CONDITIONAL_NAMES, ...GROUP_NAMES, ...GLOBAL_HUMANOID_NAMES])) {
    return { keep: true, reason: '대상+로봇어' }
  }
  return { keep: false, reason: '제목에 조건 없음' }
}
