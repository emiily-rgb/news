import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

const RECIPIENTS = ['pr2ace@gmail.com', 'pr2ace@pr2ace.com']
const MAX_ARTICLES = 20

function getKstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

function getSlot(kstHour: number): number | null {
  if (kstHour >= 11 && kstHour < 14) return 12
  if (kstHour >= 15 && kstHour < 18) return 16
  if (kstHour >= 20 && kstHour < 23) return 21
  return null
}

function getSlotDate(kstNow: Date): string {
  return kstNow.toLocaleDateString('en-CA')
}

function buildSubject(slot: number, kstNow: Date): string {
  const month = kstNow.getMonth() + 1
  const day = kstNow.getDate()
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  const weekday = weekdays[kstNow.getDay()]
  return `[화웨이 데일리 알림] ${month}/${day}(${weekday}) ${slot}:00`
}

function buildHtml(articles: { title: string; link: string; media: string; pub_date: string; category: string }[]): string {
  const byCategory: Record<string, typeof articles> = {}
  for (const a of articles) {
    if (!byCategory[a.category]) byCategory[a.category] = []
    byCategory[a.category].push(a)
  }

  const catOrder = ['자사', '업계', '정책', '위기이슈']
  const catLabels: Record<string, string> = { '자사': '자사', '업계': '업계', '정책': '정책', '위기이슈': '위기이슈' }

  const sections = catOrder
    .filter(cat => byCategory[cat]?.length)
    .map(cat => {
      const rows = byCategory[cat].map(a => {
        const time = new Date(a.pub_date).toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        })
        return `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
              <a href="${a.link}" style="color:#111;font-size:15px;font-weight:600;text-decoration:none;line-height:1.5;display:block;margin-bottom:3px">${a.title}</a>
              <span style="font-size:13px;color:#aaa">${a.media} &nbsp;·&nbsp; ${time}</span>
            </td>
          </tr>`
      }).join('')

      return `
        <tr><td style="padding:18px 0 4px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="border-left:3px solid #c8102e;padding-left:10px;font-size:16px;font-weight:700;color:#111">${catLabels[cat]}</td>
            <td style="text-align:right;font-size:13px;color:#bbb">${byCategory[cat].length}건</td>
          </tr></table>
        </td></tr>
        ${rows}`
    }).join('')

  return `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;padding:24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${sections}
        <tr><td style="padding-top:24px;font-size:12px;color:#ccc;text-align:center;border-top:1px solid #f0f0f0">
          Huawei PR 모니터링
        </td></tr>
      </table>
    </div>`
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const forceSlot = url.searchParams.get('slot')

  const kstNow = getKstNow()
  const slot = forceSlot ? parseInt(forceSlot) : getSlot(kstNow.getHours())

  if (!slot) {
    return NextResponse.json({ message: '발송 시간대 아님', hour: kstNow.getHours() })
  }

  const slotDate = getSlotDate(kstNow)
  const supabase = createServiceClient()

  const { data: articles, error } = await supabase
    .from('daily_alert_articles')
    .select('title, link, pub_date, media, category')
    .eq('slot_date', slotDate)
    .eq('slot', slot)
    .order('pub_date', { ascending: false })
    .limit(MAX_ARTICLES)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!articles || articles.length === 0) {
    return NextResponse.json({ message: '발송할 기사 없음', slot, slotDate })
  }

  const subject = buildSubject(slot, kstNow)
  const html = buildHtml(articles)

  const logId = crypto.randomUUID()
  await supabase.from('daily_alert_logs').insert({
    id: logId,
    slot,
    slot_date: slotDate,
    status: 'pending',
    recipients: RECIPIENTS,
    article_count: articles.length,
  })

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })

    const fromName = process.env.EMAIL_FROM_NAME || 'Huawei PR 모니터링'
    await transporter.sendMail({
      from: `"${fromName}" <${process.env.GMAIL_USER}>`,
      to: RECIPIENTS.join(', '),
      subject,
      html,
    })

    await supabase.from('daily_alert_logs').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', logId)

    return NextResponse.json({ success: true, slot, slotDate, articleCount: articles.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    await supabase.from('daily_alert_logs').update({ status: 'failed' }).eq('id', logId)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
