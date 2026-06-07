import { NextRequest, NextResponse } from 'next/server'
import Parser from 'rss-parser'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/server'

const parser = new Parser({ customFields: { item: ['source'] } })

// 실제 발송 시작일 (KST)
const START_DATE = new Date('2026-06-04T00:00:00+09:00')

const RSS_FEEDS = [
  'https://news.google.com/rss/search?q=Huawei&hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/search?q=Huawei+Korea&hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/search?q=화웨이&hl=ko&gl=KR&ceid=KR:ko',
  'https://rss.etnews.com/Section901.xml',
  'https://inews24.com/rss/allnews.xml',
]

// 카테고리 분류 키워드
const CATEGORY_KEYWORDS = {
  위기이슈: ['제재', '규제', '차단', '금지', '위협', '보안위협', '리스크', '피해', '논란', '갈등', '분쟁', '수출통제', '블랙리스트', '제한', '침해', '해킹', '사이버'],
  자사: ['화웨이', 'Huawei', '화웨이코리아', 'Huawei Korea', 'HarmonyOS', 'Ascend', '화웨이 클라우드', 'Huawei Cloud', '타오의 법칙', '허의 법칙', '에릭 쉬', '화웨이코리아', 'ORAN'],
  정책: ['과학기술정보통신부', '과기정통부', '과기부', '방송통신위원회', '반도체특별법', 'K칩스법', '전기통신사업법', '국가정보원', 'KISA', '인공지능 기본법', 'AI G3', '공급망 보안', '수출통제', '미국 반도체 규제', '대중국 규제', '국가핵심기술', '산업기술보호법', '정책', '법안', '규제'],
}

interface ArticleItem {
  title: string
  link: string
  pubDate: string
  media: string
  category: '자사' | '업계' | '정책' | '위기이슈'
}

function classifyArticle(title: string): ArticleItem['category'] {
  const t = title.toLowerCase()
  // 위기이슈 먼저 (화웨이 관련 부정 기사 우선 분류)
  if (CATEGORY_KEYWORDS.위기이슈.some(k => t.includes(k.toLowerCase()))) return '위기이슈'
  if (CATEGORY_KEYWORDS.자사.some(k => t.includes(k.toLowerCase()))) return '자사'
  if (CATEGORY_KEYWORDS.정책.some(k => t.includes(k.toLowerCase()))) return '정책'
  return '업계'
}

async function getKeywords(): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('configs').select('value').eq('key', 'main').single()
  const categories = data?.value?.keywords ?? []
  const all: string[] = []
  for (const cat of categories) {
    if (Array.isArray(cat.keywords)) all.push(...cat.keywords)
  }
  return all.length > 0 ? all : ['화웨이', 'Huawei']
}

async function getSentLinks(): Promise<Set<string>> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('configs').select('value').eq('key', 'monitor_sent').single()
  const links: string[] = data?.value?.links ?? []
  return new Set(links)
}

async function saveSentLinks(newLinks: string[], existingLinks: Set<string>) {
  const supabase = createServiceClient()
  // 최근 500개만 유지 (오래된 것 자동 제거)
  const all = [...newLinks, ...existingLinks].slice(0, 500)
  await supabase.from('configs').upsert({
    key: 'monitor_sent',
    value: { links: all, updated_at: new Date().toISOString() }
  }, { onConflict: 'key' })
}

async function collectArticles(keywords: string[], sentLinks: Set<string>): Promise<ArticleItem[]> {
  const seen = new Set<string>()
  const articles: ArticleItem[] = []
  const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000

  for (const feedUrl of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl)
      for (const item of feed.items?.slice(0, 50) ?? []) {
        if (!item.title || !item.link) continue
        const titleLower = item.title.toLowerCase()
        const isMatch = keywords.some(k => titleLower.includes(k.toLowerCase()))
        if (!isMatch) continue
        const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0
        if (pubTime < fourHoursAgo) continue
        if (seen.has(item.title.trim())) continue
        if (sentLinks.has(item.link)) continue  // 직전 세션 중복 제거
        seen.add(item.title.trim())
        articles.push({
          title: item.title.trim(),
          link: item.link,
          pubDate: item.pubDate || new Date().toISOString(),
          media: (item as any).source?.name || feed.title || '미확인',
          category: classifyArticle(item.title),
        })
      }
    } catch { /* 피드 실패 건너뜀 */ }
  }

  return articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
}

function buildDailyAlertEmail(articles: ArticleItem[], timeLabel: string): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  const CATS: ArticleItem['category'][] = ['위기이슈', '자사', '업계', '정책']
  const CAT_COLOR: Record<string, string> = {
    위기이슈: '#c8102e', 자사: '#1a73e8', 업계: '#e07b00', 정책: '#2e7d32'
  }
  const CAT_LABEL: Record<string, string> = {
    위기이슈: '⚠️ 위기이슈 (Crisis)', 자사: '🏢 자사 (Huawei)', 업계: '🏭 업계 (Industry)', 정책: '📋 정책 (Policy)'
  }

  const sections = CATS.map(cat => {
    const catArticles = articles.filter(a => a.category === cat)
    if (catArticles.length === 0) return ''
    const color = CAT_COLOR[cat]
    const rows = catArticles.map(a => {
      const pub = new Date(a.pubDate).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5">
        <a href="${a.link}" style="color:#1a73e8;font-size:13px;font-weight:bold;text-decoration:none;line-height:1.5;display:block;margin-bottom:3px">${a.title}</a>
        <div style="font-size:11px;color:#999">${a.media} &nbsp;|&nbsp; ${pub}</div>
      </td></tr>`
    }).join('')

    return `<tr><td style="padding:14px 0 4px 0">
      <div style="background:${color};color:#fff;padding:6px 14px;font-size:12px;font-weight:bold;border-radius:4px;display:inline-block;margin-bottom:4px">${CAT_LABEL[cat]} · ${catArticles.length}건</div>
    </td></tr>
    ${rows}`
  }).join('')

  const totalCount = articles.length

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:'Microsoft YaHei','Apple SD Gothic Neo',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0">
<tr><td align="center" style="padding:20px 10px">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;max-width:640px">

  <tr><td style="background:#1a1a2e;padding:18px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:1px;margin-bottom:4px">HUAWEI DAILY ALERT</div>
        <div style="color:#fff;font-size:16px;font-weight:bold">데일리 알림 · ${timeLabel}</div>
      </td>
      <td style="text-align:right;vertical-align:middle">
        <div style="color:rgba(255,255,255,0.7);font-size:11px">${dateStr}</div>
        <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:2px">신규 ${totalCount}건</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:16px 24px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${totalCount > 0 ? sections : `<tr><td style="padding:20px;color:#999;font-size:13px;text-align:center">이번 세션 신규 기사가 없습니다.</td></tr>`}
    </table>
  </td></tr>

  <tr><td style="padding:12px 24px;background:#f8f8f8;border-top:1px solid #e8e8e8">
    <div style="font-size:11px;color:#aaa;text-align:center">Huawei Korea PR Monitoring · 데일리 알림 자동 발송</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = req.headers.get('x-cron-secret')
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isManual = cronSecret === (process.env.CRON_SECRET ?? 'huawei-cron')
  if (!isVercelCron && !isManual) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 6월 4일 이전엔 발송 안 함
  const now = new Date()
  if (now < START_DATE && !isManual) {
    return NextResponse.json({ message: '발송 시작일 전입니다', startDate: START_DATE.toISOString() })
  }

  const hourKST = now.toLocaleString('ko-KR', { hour: 'numeric', hour12: false, timeZone: 'Asia/Seoul' })
  const timeLabel = `${hourKST}:00`

  const [keywords, sentLinks] = await Promise.all([getKeywords(), getSentLinks()])
  const articles = await collectArticles(keywords, sentLinks)

  // 수신자 목록
  const supabase = createServiceClient()
  const { data: config } = await supabase.from('configs').select('value').eq('key', 'main').single()
  const recipients: string[] = config?.value?.recipients ?? []

  if (recipients.length === 0) {
    return NextResponse.json({ message: '수신자 없음', articles: articles.length })
  }

  // 발송 후 링크 저장 (중복 방지용)
  if (articles.length > 0) {
    await saveSentLinks(articles.map(a => a.link), sentLinks)
  }

  const html = buildDailyAlertEmail(articles, timeLabel)
  const dateStr = now.toISOString().slice(0, 10)
  const subject = `[Huawei Daily Alert] ${dateStr} ${timeLabel} · 신규 ${articles.length}건`

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `"Huawei PR Monitoring" <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    bcc: 'pr2ace1@gmail.com',
    subject,
    html,
  })

  return NextResponse.json({ success: true, articles: articles.length, recipients: recipients.length })
}
