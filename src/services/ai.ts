import Anthropic from '@anthropic-ai/sdk'
import { RawArticle } from './collector'
import { Article, Sentiment, ImpactLevel, ArticleTag, EmergingSignals } from '@/types'

const MODEL = 'claude-sonnet-4-5'
const FILTER_MODEL = 'claude-haiku-4-5'

// AI 응답 JSON을 최대한 안전하게 파싱
function robustJsonParse(text: string): Record<string, unknown> {
  const block = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
  // 1차: 직접 파싱
  try { return JSON.parse(block) } catch { /* pass */ }
  // 2차: 제어문자 제거 후 파싱
  try { return JSON.parse(block.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')) } catch { /* pass */ }
  // 3차: 문자열 값 내부의 unescaped " 를 ' 로 치환
  try {
    const fixed = block.replace(/"((?:[^"\\]|\\.)*)"/g, (_m, inner: string) =>
      `"${inner.replace(/(?<!\\)"/g, '\\"')}"`)
    return JSON.parse(fixed)
  } catch { /* pass */ }
  // 4차: 줄별로 파싱 가능한 값만 추출
  const result: Record<string, unknown> = {}
  for (const line of block.split('\n')) {
    const m = line.match(/"(\w+)"\s*:\s*"([^"]*)"/)
    if (m) result[m[1]] = m[2]
  }
  return result
}

// AI가 tag를 배열이나 JSON 배열 문자열로 반환할 때 첫 번째 값만 추출
function normalizeTag(raw: unknown): ArticleTag {
  if (Array.isArray(raw)) return (raw[0] as ArticleTag) ?? 'AI'
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed)
        if (Array.isArray(arr) && arr.length > 0) return arr[0] as ArticleTag
      } catch { /* pass */ }
    }
    if (trimmed === 'Semiconductor') return 'AI Semiconductor'
    return (trimmed as ArticleTag) || 'AI'
  }
  return 'AI'
}

function getClient() {
  return new Anthropic({ apiKey: process.env['NEWS_AI_KEY'] })
}

// ── 1단계: 필터링 + 카테고리 분류 + 태그/영향도 판단 ──
const FILTER_PROMPT = (lines: string) => `당신은 화웨이 임원용 뉴스 클리핑 에디터다.

아래 기사 목록을 분석하여 JSON 배열로 응답하라.

기사 목록:
${lines}

각 기사에 대해 판단:

1. relevant: 아래 포함 기준을 충족하고 제외 기준에 해당하지 않으면 true

   포함: 화웨이 관련, AI, Ascend, Cloud, Data Center, Semiconductor, Network, Smartphone, 통신장비, 공급망, 실적, 투자, 파트너십, 중국 IT 산업, AI 서버, 반도체 산업, 미국 대중국 규제, 중국 정부 정책, AI 정책, 수출통제, 보안 규제, 5G, 6G, 주파수, 주파수 할당, LGU+, NPU, 스마트 캠퍼스, 스마트 병원, SSD, 낸드플래시, 디지털 파워, 데이터센터 전력, 태양광, 신재생에너지, ESS, 썬그로우, Sungrow, 루프엔지니어링, 화웨이 에너지, 웨어러블, 스마트워치, 스마트카, 차량용 반도체, 자율주행, 인재양성, 인재육성, ICT 정책, 과기정통부, 통신 정책

   ※ 포함 기준에 해당하면 관대하게 true로 판단할 것. 의심스러우면 true.

   제외(false): 단순 행사·포럼 개최, 인터뷰·홍보성, 체험·리뷰, 칼럼·사설, 단순 마케팅, 스포츠·연예·사회면, 증권·증시 시황 기사(주가 등락·목표주가·투자의견·수급 동향 등 단순 주식시장 리포트성 기사는 웬만하면 제외. 단, 반도체·AI 산업 자체의 구조적 변화를 다루는 기사면 포함)
   ※ 단, 정부·규제·정책 관련 회의·협력·논의·국제공조 기사(예: 과기정통부 정책, 한일 6G·전파 협력, 주파수·표준 논의 등)는 "단순 행사"로 보지 말고 포함(true). 산업·정책 영향이 있으면 행사·포럼 형식이어도 포함.

   조선일보·중앙일보·동아일보는 정책·정무·산업 영향 기사만 포함

2. category: "자사" | "업계" | "정책" | "위기이슈"
   ※ 우선순위: 자사 > 위기이슈 > 정책 > 업계 순으로 판단. 화웨이가 기사의 주인공이면 반드시 자사.
   ※ 단, 화웨이 Ascend(어센드) AI 반도체 관련 기사는 화웨이가 주인공이더라도 반드시 "업계"로 분류. Ascend/어센드를 단순 언급하거나 주요 내용으로 다루는 기사 모두 "업계"로 분류할 것. (위기이슈·정책에 해당하면 그쪽 우선)
   - 자사: 화웨이(Huawei)가 기사의 주체·주인공인 경우 (화웨이 제품 출시, 화웨이 실적, 화웨이 파트너십, 화웨이 사업 동향 등). 기사에 화웨이가 언급되더라도 주인공이 타사면 업계. ※ Ascend/어센드 반도체 기사는 예외적으로 업계.
     ※ 제목에 화웨이가 없더라도 요약(description)에서 화웨이/Huawei가 비중있게 언급되거나(2회 이상 또는 핵심 주어로 등장) 기사 내용의 주된 주제가 화웨이인 경우 자사로 판단.
   - 업계: 화웨이 외 기업/시장 동향 (NVIDIA·삼성·SK하이닉스·LGU+·퀄컴 등 타사, AI서버·반도체·5G·6G·주파수·NPU·스마트캠퍼스·병원·SSD·낸드·디지털파워·웨어러블·스마트카·차량반도체 업계 트렌드)
   - 정책: 정부·규제가 주제 (미국규제·중국정책·AI정책·수출통제·보안규제). 화웨이가 직접 언급되면 자사 또는 위기이슈 우선.
   - 위기이슈: 화웨이 관련 보안위협·제재·스파이·해킹·백도어·도청·정보유출·엔티티리스트·보이콧·배제

3. tag: "AI" | "Cloud" | "Network" | "Smartphone" | "Policy" | "US Sanctions" | "China" | "Data Center" | "Investment" | "AI Semiconductor" | "Smart Campus" | "Smart Hospital" | "SSD" | "Digital Power" | "Smart Device" | "IAS" | "Talent Development"
   태그 가이드: Network=5G/6G/주파수/LGU+/통신망, AI Semiconductor=반도체/NPU/AI칩/AI서버/엔비디아/HBM/TSMC/DRAM/NAND/파운드리 등 반도체 전반, Smart Campus=스마트캠퍼스/캠퍼스솔루션, Smart Hospital=스마트병원/의료솔루션, SSD=SSD/낸드플래시/NAND, Digital Power=디지털파워/데이터센터전력/태양광/신재생에너지/ESS/썬그로우/Sungrow/루프엔지니어링/화웨이에너지, Smart Device=웨어러블/스마트워치, IAS=스마트카/차량용반도체/자율주행, Talent Development=인재양성/인재육성/SW인재/AI인재/개발자육성/교육프로그램

4. impact_level: "HIGH" | "MEDIUM" | "LOW"

5. sentiment: "positive" | "negative" | "neutral" (화웨이 관점)

6. relevance_score: 0.0~1.0

동일 이슈가 여러 기사면 가장 신뢰도 높은 1건만 relevant:true

응답 형식 (JSON 배열만, 다른 텍스트 없이):
[{"index":0,"relevant":true,"category":"자사","tag":"AI","impact_level":"HIGH","sentiment":"positive","relevance_score":0.9},...]`

type FilterResult = { index: number; relevant: boolean; category: string; tag: ArticleTag; impact_level: ImpactLevel; sentiment: Sentiment; relevance_score: number }

async function filterBatch(batch: RawArticle[], offset: number): Promise<FilterResult[]> {
  const lines = batch.map((a, i) => {
    const desc = (a as any).description
    const cleanDesc = typeof desc === 'string'
      ? desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      : ''
    const descPart = cleanDesc ? ` | 요약: "${cleanDesc}"` : ''
    return `[${offset + i}] 제목: "${a.title}" | 매체: ${a.media} | 검색키워드: ${a.keyword}${descPart}`
  }).join('\n')
  console.log(`[filterBatch] offset=${offset}, batch=${batch.length}건`)
  const response = await getClient().messages.create({
    model: FILTER_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: FILTER_PROMPT(lines) }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  console.log(`[filterBatch] AI 응답 앞부분:`, text.slice(0, 300))
  try {
    const parsed: FilterResult[] = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
    parsed.forEach(r => { r.tag = normalizeTag(r.tag) })
    const trueCount = parsed.filter(r => r.relevant).length
    console.log(`[filterBatch] 파싱 결과: ${parsed.length}건, relevant=true: ${trueCount}건`)
    return parsed
  } catch {
    console.error('[filterBatch] JSON 파싱 실패 → 전체 통과 처리')
    return batch.map((_, i) => ({
      index: offset + i, relevant: true, category: '업계', tag: 'AI' as ArticleTag,
      impact_level: 'MEDIUM' as ImpactLevel, sentiment: 'neutral' as Sentiment, relevance_score: 0.5
    }))
  }
}

export async function filterArticles(
  articles: RawArticle[],
  mediaTiers: Record<string, number>
): Promise<(RawArticle & { mediaTier: number; sentiment: Sentiment; relevanceScore: number; finalCategory: string; tag: ArticleTag; impactLevel: ImpactLevel })[]> {
  if (articles.length === 0) return []

  // 30개씩 배치 처리 (토큰 한도 초과 방지)
  const BATCH_SIZE = 30
  const allResults: FilterResult[] = []
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE)
    const results = await filterBatch(batch, i)
    allResults.push(...results)
    if (i + BATCH_SIZE < articles.length) await new Promise(r => setTimeout(r, 500))
  }

  const filtered = articles
    .map((article, i) => {
      const r = allResults.find(x => x.index === i) ?? {
        relevant: false, category: '업계', tag: 'AI' as ArticleTag,
        impact_level: 'LOW' as ImpactLevel, sentiment: 'neutral' as Sentiment, relevance_score: 0
      }
      const tier = (mediaTiers ?? {})[article.media] ?? 3
      return {
        ...article,
        mediaTier: tier,
        sentiment: r.sentiment,
        relevanceScore: r.relevance_score,
        finalCategory: r.category,
        tag: r.tag,
        impactLevel: r.impact_level,
        // 위기이슈는 분류 기준(카테고리 정의)만 유지하고, 실제 브리핑에는 포함하지 않는다.
        _relevant: r.relevant && r.category !== '위기이슈',
      }
    })
    .filter(a => (a as any)._relevant)
    .map(({ _relevant, ...a }) => a)

  // 배치 간 중복 이슈 클러스터링: 제목 유사도 기반으로 같은 이슈 묶기
  // 우선순위: A) mediaTier 낮을수록 우선 (1=최상위) → B) relevanceScore 높을수록 우선
  function titleTokens(title: string): Set<string> {
    return new Set(title.replace(/[\s\W]/g, ' ').split(' ').filter(t => t.length >= 2))
  }

  function isSameIssue(a: string, b: string): boolean {
    const ta = titleTokens(a)
    const tb = titleTokens(b)
    const intersection = [...ta].filter(t => tb.has(t)).length
    const union = new Set([...ta, ...tb]).size
    return union > 0 && intersection / union >= 0.4 // 40% 이상 겹치면 같은 이슈
  }

  const dedupedIndices = new Set<number>()
  const kept: typeof filtered = []

  for (let i = 0; i < filtered.length; i++) {
    if (dedupedIndices.has(i)) continue
    const cluster = [i]
    for (let j = i + 1; j < filtered.length; j++) {
      if (!dedupedIndices.has(j) && isSameIssue(filtered[i].title, filtered[j].title)) {
        cluster.push(j)
        dedupedIndices.add(j)
      }
    }
    // 클러스터 내에서 최우선 기사 선택: mediaTier 오름차순 → relevanceScore 내림차순
    const best = cluster
      .map(idx => filtered[idx])
      .sort((a, b) => a.mediaTier - b.mediaTier || b.relevanceScore - a.relevanceScore)[0]
    kept.push(best)
  }

  console.log(`[dedup] 필터 통과: ${filtered.length}건 → 중복 제거 후: ${kept.length}건`)
  return kept
}

// ── 2단계: 요약 + 번역 + Why It Matters ──
export async function summarizeAndTranslate(
  articles: (RawArticle & { mediaTier: number; sentiment: Sentiment; relevanceScore: number; finalCategory: string; tag: ArticleTag; impactLevel: ImpactLevel })[]
): Promise<Partial<Article>[]> {
  async function summarizeOne(article: typeof articles[0]): Promise<Partial<Article> | null> {
    const safeTitle = article.title.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim()
    const prompt = `당신은 화웨이 임원용 뉴스 브리핑 전문 에디터다.

다음 기사를 분석하라.

제목: ${safeTitle}
매체: ${article.media}
카테고리: ${article.finalCategory}
태그: ${article.tag}
영향도: ${article.impactLevel}

작성 기준:
- KR Summary: 임원 관점에서 핵심만 정확히 2문장. 번호 없이 문장으로. 반드시 명사형 종결로 작성 (예: "~급증", "~발표", "~전망", "~강화"). 존댓말·반말 동사형 종결 금지.
- CN Summary: KR Summary의 중국어 간체 번역. 직역 금지, 현지화.
- title_zh: 기사 제목 중국어 간체 번역 (비즈니스 현지화)
- why_it_matters_ko: 임원 관점에서 왜 중요한지 1~2문장 (사업 영향 중심). 반드시 명사형 종결로 작성. 존댓말·반말 동사형 종결 금지.
- why_it_matters_zh: why_it_matters_ko의 중국어 간체 번역

응답 형식 (JSON만):
{
  "title_zh": "중국어 제목",
  "summary_ko": ["문장1", "문장2"],
  "summary_zh": ["句子1", "句子2"],
  "why_it_matters_ko": "임원 관점 중요성",
  "why_it_matters_zh": "中文重要性"
}`

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await getClient().messages.create({
          model: MODEL,
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        })
        const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
        const parsed = robustJsonParse(text)
        return {
          title: article.title,
          title_zh: (parsed.title_zh as string) ?? '',
          media: article.media,
          media_tier: article.mediaTier,
          link: article.link,
          pub_date: article.pubDate,
          category: article.finalCategory,
          keyword: article.keyword,
          summary_ko: ((parsed.summary_ko as string[]) ?? []).slice(0, 2),
          summary_zh: ((parsed.summary_zh as string[]) ?? []).slice(0, 2),
          sentiment: article.sentiment,
          relevance_score: article.relevanceScore,
          image_url: article.imageUrl ?? null,
          tag: article.tag,
          impact_level: article.impactLevel,
          why_it_matters_ko: (parsed.why_it_matters_ko as string) ?? null,
          why_it_matters_zh: (parsed.why_it_matters_zh as string) ?? null,
          excluded: false,
        }
      } catch (err) {
        console.error(`요약 실패 [시도 ${attempt}/3] [${article.title}]:`, err)
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
    console.error(`요약 최종 실패, 건너뜀: ${article.title}`)
    return null
  }

  // 5개씩 병렬 처리
  const CONCURRENCY = 5
  const results: Partial<Article>[] = []
  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(summarizeOne))
    results.push(...batchResults.filter((r): r is Partial<Article> => r !== null))
  }

  return results
}

// ── 3단계: Executive Brief 생성 ──
export async function generateInsight(articles: Partial<Article>[]): Promise<{
  ko: string[]
  zh: string[]
  keyTakeaways: string[]
  emergingSignals: EmergingSignals
  tomorrowWatchlist: string[]
}> {
  // 화웨이 요청: Ascend(어센드) 관련 기사는 '오늘의 하이라이트'에서 제외
  const isAscend = (a: Partial<Article>) => {
    const text = `${a.title ?? ''} ${a.summary_ko?.join(' ') ?? ''}`.toLowerCase()
    return text.includes('ascend') || text.includes('어센드')
  }
  const active = articles.filter(a => !a.excluded && !isAscend(a))

  // 자사 기사를 앞에 배치하여 AI가 첫 문장에 자사 내용을 쓰도록 유도
  const sorted = [
    ...active.filter(a => a.category === '자사'),
    ...active.filter(a => a.category !== '자사'),
  ]

  const sanitize = (s?: string) => (s ?? '').replace(/["'\\]/g, ' ').replace(/\s+/g, ' ').trim()
  const articleSummary = sorted
    .map(a => `[${a.category}][${a.tag}][${a.impact_level}] ${sanitize(a.title)}\n  요약: ${sanitize(a.summary_ko?.join(' '))}`)
    .join('\n\n')

  const highCount = active.filter(a => a.impact_level === 'HIGH').length
  const negativeCount = active.filter(a => a.sentiment === 'negative').length

  const prompt = `당신은 화웨이 임원용 Executive Brief를 작성하는 전문 에디터다.

오늘 수집된 기사:
${articleSummary}

통계: 전체 ${active.length}건 | HIGH ${highCount}건 | 부정 ${negativeCount}건

아래 항목을 작성하라.

1. executive_summary_ko: 오늘의 하이라이트를 최대 3~4개 문장으로 요약. 기사 원문에 명시된 사실만 근거로 보수적으로 작성할 것 — 추측·과장·기사에 없는 해석 금지. 문장은 짧고 간결하게. 반드시 명사형 종결로 작성 (예: "~급증", "~발표", "~전망", "~강화"). 존댓말·반말 동사형 종결 금지.
   ※ 자사(화웨이) 관련 기사가 있는 경우, 반드시 첫 번째 문장에 자사 내용을 배치할 것. 자사 기사가 없더라도 화웨이 관점에서 가장 중요한 이슈를 첫 문장으로 작성.
2. executive_summary_zh: executive_summary_ko의 중국어 간체 번역
3. emerging_signals: 반복적으로 나타나는 흐름
   - positive: 긍정 신호 최대 3개 (한국어, 명사형 종결)
   - positive_zh: positive의 중국어 간체 번역
   - risk: 리스크 신호 최대 3개 (한국어, 명사형 종결)
   - risk_zh: risk의 중국어 간체 번역
4. tomorrow_watchlist: 내일 추가 모니터링 필요 이슈 최대 3개 (한국어, 명사형 종결)
모든 한국어 항목은 반드시 반말체로 작성. 존댓말 금지.

응답 형식 (JSON만):
{
  "executive_summary_ko": ["문장1", "문장2"],
  "executive_summary_zh": ["句子1", "句子2"],
  "emerging_signals": {
    "positive": ["• 긍정신호1", "• 긍정신호2"],
    "positive_zh": ["• 正面信号1", "• 正面信号2"],
    "risk": ["• 리스크1", "• 리스크2"],
    "risk_zh": ["• 风险1", "• 风险2"]
  },
  "tomorrow_watchlist": ["• 이슈1", "• 이슈2", "• 이슈3"]
}`

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

    let parsed: Record<string, unknown> = {}
    try {
      parsed = robustJsonParse(text)
    } catch (parseErr) {
      console.error('[generateInsight] JSON 파싱 실패:', parseErr)
      return {
        ko: [], zh: [],
        keyTakeaways: [], emergingSignals: { positive: [], risk: [] }, tomorrowWatchlist: [],
      }
    }

    return {
      ko: (parsed.executive_summary_ko as string[]) ?? [],
      zh: (parsed.executive_summary_zh as string[]) ?? [],
      keyTakeaways: [],
      emergingSignals: (parsed.emerging_signals as EmergingSignals) ?? { positive: [], risk: [] },
      tomorrowWatchlist: (parsed.tomorrow_watchlist as string[]) ?? [],
    }
  } catch (err) {
    console.error('[generateInsight] API 호출 실패:', err)
    return { ko: [], zh: [], keyTakeaways: [], emergingSignals: { positive: [], risk: [] }, tomorrowWatchlist: [] }
  }
}

// ── 수동 기사 처리: URL + 본문 → 카테고리/요약/번역 한 번에 ──
export async function processManualArticle(input: {
  url: string
  title: string
  bodyText: string
  media: string
  pubDate: string
}): Promise<Partial<Article>> {
  const prompt = `당신은 화웨이 임원용 뉴스 브리핑 전문 에디터다.

아래 기사를 분석하여 JSON으로 응답하라.

URL: ${input.url}
매체: ${input.media}
제목: ${input.title}
${input.bodyText.trim()
  ? `본문 (일부):\n${input.bodyText.slice(0, 3000)}`
  : '(본문 미수집 - 제목과 URL만으로 분석할 것)'
}

판단 및 작성:
1. category: "자사"(화웨이 직접) | "업계"(시장/경쟁사/AI/반도체) | "정책"(정부/규제) | "위기이슈"(보안위협/제재/해킹/스파이/정보유출)
   ※ 화웨이 Ascend(어센드) AI 반도체 관련 기사는 화웨이가 주인공이더라도 반드시 "업계"로 분류. 단순 언급·주요 내용 모두 "업계". (위기이슈·정책 우선순위는 유지)
2. tag: "AI"|"Cloud"|"Network"|"Smartphone"|"Policy"|"US Sanctions"|"China"|"Data Center"|"Investment"|"AI Semiconductor"|"Smart Campus"|"Smart Hospital"|"SSD"|"Digital Power"|"Smart Device"|"IAS"|"Talent Development"
   태그 가이드: Network=5G/6G/주파수/LGU+/통신망, AI Semiconductor=반도체/NPU/AI칩/AI서버/엔비디아/HBM/TSMC/DRAM/NAND/파운드리 등 반도체 전반, Smart Campus=스마트캠퍼스/캠퍼스솔루션, Smart Hospital=스마트병원/의료솔루션, SSD=SSD/낸드플래시/NAND, Digital Power=디지털파워/데이터센터전력/태양광/신재생에너지/ESS/썬그로우/Sungrow/루프엔지니어링/화웨이에너지, Smart Device=웨어러블/스마트워치, IAS=스마트카/차량용반도체/자율주행, Talent Development=인재양성/인재육성/SW인재/AI인재/개발자육성/교육프로그램
3. impact_level: "HIGH"|"MEDIUM"|"LOW" (임원 관점 중요도)
4. sentiment: "positive"|"negative"|"neutral" (화웨이 관점)
5. title_zh: 제목 중국어 간체 번역
6. summary_ko: 임원 관점 핵심 요약 정확히 2문장 (배열). 반드시 명사형 종결 (예: "~급증", "~발표", "~전망"). 존댓말·반말 동사형 종결 금지.
7. summary_zh: summary_ko의 중국어 간체 번역 (배열)
8. why_it_matters_ko: 왜 중요한지 1~2문장 (사업 영향 중심). 반드시 명사형 종결. 존댓말·반말 동사형 종결 금지.
9. why_it_matters_zh: why_it_matters_ko의 중국어 간체 번역

중요: 텍스트 값 안에 큰따옴표(")를 사용하지 말 것. 인용이 필요하면 작은따옴표(')로 대체.

응답 형식 (JSON만):
{
  "category": "업계",
  "tag": "AI",
  "impact_level": "HIGH",
  "sentiment": "neutral",
  "title_zh": "중국어 제목",
  "summary_ko": ["문장1", "문장2"],
  "summary_zh": ["句子1", "句子2"],
  "why_it_matters_ko": "중요성",
  "why_it_matters_zh": "重要性"
}`

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

  // JSON 블록 추출 후 파싱 (robust)
  let parsed: Record<string, unknown> = {}
  try {
    const raw = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
    // 제어문자 제거
    let jsonStr = raw.replace(/[\x00-\x1F\x7F]/g, m => '\n\r\t'.includes(m) ? m : ' ')
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      // JSON 스트링 값 내부의 탈출 안 된 따옴표 수정 시도
      jsonStr = jsonStr.replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) => {
        const fixed = inner.replace(/(?<!\\)"/g, "'")
        return `"${fixed}"`
      })
      parsed = JSON.parse(jsonStr)
    }
  } catch {
    console.error('[processManualArticle] JSON 파싱 최종 실패\n원문:', text.slice(0, 500))
  }

  return {
    title: input.title,
    title_zh: (parsed.title_zh as string) ?? '',
    media: input.media,
    media_tier: 2,
    link: input.url,
    pub_date: input.pubDate,
    category: (parsed.category as string) ?? '업계',
    keyword: '수동입력',
    summary_ko: ((parsed.summary_ko as string[]) ?? []).slice(0, 2),
    summary_zh: ((parsed.summary_zh as string[]) ?? []).slice(0, 2),
    sentiment: (parsed.sentiment as Sentiment) ?? 'neutral',
    relevance_score: 1.0,
    image_url: null,
    tag: normalizeTag(parsed.tag),
    impact_level: (parsed.impact_level as ImpactLevel) ?? 'MEDIUM',
    why_it_matters_ko: (parsed.why_it_matters_ko as string) ?? null,
    why_it_matters_zh: (parsed.why_it_matters_zh as string) ?? null,
    excluded: false,
    order_index: null,
  }
}
