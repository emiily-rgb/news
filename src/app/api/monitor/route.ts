import { NextRequest, NextResponse } from 'next/server'
import Parser from 'rss-parser'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/server'

const parser = new Parser({ customFields: { item: ['source'] } })

// RSS 피드 목록
const RSS_FEEDS = [
  'https://news.google.com/rss/search?q=화웨이&hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/search?q=Huawei&hl=ko&gl=KR&ceid=KR:ko',
  'https://rss.etnews.com/Section901.xml',
  'https://zdnet.co.kr/rss/news/',
  'https://www.ddaily.co.kr/rss/news/allnews.xml',
]

interface ArticleItem {
  title: string
  link: string
  pubDate: string
  media: string
}

async function getKeywords(): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('configs').select('value').eq('key', 'main').single()
  const categories = data?.value?.keywords ?? []
  const allKeywords: string[] = []
  for (const cat of categories) {
    if (Array.isArray(cat.keywords)) allKeywords.push(...cat.keywords)
  }
  return allKeywords.length > 0 ? allKeywords : ['화웨이', 'Huawei']
}

async function collectArticles(keywords: string[]): Promise<ArticleItem[]> {
  const seen = new Set<string>()
  const articles: ArticleItem[] = []
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000

  for (const feedUrl of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl)
      for (const item of feed.items ?? []) {
        if (!item.title || !item.link) continue

        // 키워드 포함 여부 확인
        const titleLower = item.title.toLowerCase()
        const isMatch = keywords.some(k => titleLower.includes(k.toLowerCase()))
        if (!isMatch) continue

        // 최근 3시간 이내 기사만
        const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0
        if (pubTime < threeHoursAgo) continue

        // 중복 제거
        const key = item.title.trim()
        if (seen.has(key)) continue
        seen.add(key)

        const media = (item as any).source?.name || feed.title || '미확인'
        articles.push({
          title: item.title.trim(),
          link: item.link,
          pubDate: item.pubDate || new Date().toISOString(),
          media,
        })
      }
    } catch {
      // 피드 실패 시 건너뜀
    }
  }

  return articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
}

function buildMonitorEmail(articles: ArticleItem[], timeLabel: string): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  const rows = articles.length > 0
    ? articles.map(a => {
        const pubDate = new Date(a.pubDate).toLocaleString('ko-KR', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        return `
        <tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
          <a href="${a.link}" style="color:#1a73e8;font-size:14px;font-weight:bold;text-decoration:none;line-height:1.5;display:block;margin-bottom:4px">${a.title}</a>
          <div style="font-size:11px;color:#999">${a.media} &nbsp;|&nbsp; ${pubDate}</div>
        </td></tr>`
      }).join('')
    : `<tr><td style="padding:20px 0;color:#999;font-size:13px;text-align:center">새로운 화웨이 관련 기사가 없습니다.</td></tr>`

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:'Microsoft YaHei','Apple SD Gothic Neo',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0">
<tr><td align="center" style="padding:20px 10px">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;max-width:640px">

  <tr><td style="background:#c8102e;padding:18px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="color:#fff;font-size:11px;letter-spacing:1px;opacity:0.8;margin-bottom:4px">HUAWEI MONITORING</div>
        <div style="color:#fff;font-size:16px;font-weight:bold">화웨이 주요 기사 알림 · ${timeLabel}</div>
      </td>
      <td style="text-align:right;vertical-align:middle">
        <div style="color:rgba(255,255,255,0.8);font-size:11px">${dateStr}</div>
        <div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:2px">${articles.length}건</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:16px 24px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${rows}
    </table>
  </td></tr>

  <tr><td style="padding:12px 24px;background:#f8f8f8;border-top:1px solid #e8e8e8">
    <div style="font-size:11px;color:#aaa;text-align:center">Huawei Korea PR Monitoring · 자동 발송</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  // Vercel cron 또는 수동 호출 인증
  const authHeader = req.headers.get('authorization')
  const cronSecret = req.headers.get('x-cron-secret')
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isManual = cronSecret === (process.env.CRON_SECRET ?? 'huawei-cron')
  if (!isVercelCron && !isManual) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const hour = now.toLocaleString('ko-KR', { hour: 'numeric', hour12: false, timeZone: 'Asia/Seoul' })
  const timeLabel = `${hour}:00`

  // 키워드 + 기사 수집
  const keywords = await getKeywords()
  const articles = await collectArticles(keywords)

  // 수신자 목록
  const supabase = createServiceClient()
  const { data: config } = await supabase.from('config').select('recipients').single()
  const recipients: string[] = config?.recipients ?? []

  if (recipients.length === 0) {
    return NextResponse.json({ message: '수신자 없음', articles: articles.length })
  }

  // 이메일 발송
  const html = buildMonitorEmail(articles, timeLabel)
  const subject = `[Huawei 모니터링] ${now.toLocaleDateString('ko-KR')} ${timeLabel} (${articles.length}건)`

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `"Huawei PR Monitoring" <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject,
    html,
  })

  return NextResponse.json({ success: true, articles: articles.length, recipients: recipients.length })
}
