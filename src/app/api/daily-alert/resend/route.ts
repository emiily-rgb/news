import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import nodemailer from 'nodemailer'

const MAX_ARTICLES = 30

function getKstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
}

function buildSubject(slot: number, slotDate: string): string {
  const d = new Date(slotDate + 'T00:00:00+09:00')
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  const weekday = weekdays[d.getDay()]
  return `[화웨이 데일리 알림] ${month}/${day}(${weekday}) ${slot}:00`
}

function buildHtml(articles: { title: string; link: string; pub_date: string; media: string; category: string }[]) {
  const rows = articles.map(a => {
    const time = new Date(a.pub_date).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
          <a href="${a.link}" style="font-size:14px;color:#1a1a1a;text-decoration:none;font-weight:500;line-height:1.4">${a.title}</a>
          <div style="margin-top:4px">
            <span style="font-size:12px;color:#aaa">${a.media} &nbsp;·&nbsp; ${time}</span>
          </div>
        </td>
      </tr>`
  }).join('')

  return `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,sans-serif;padding:24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${rows}
        <tr><td style="padding-top:24px;font-size:12px;color:#ccc;text-align:center;border-top:1px solid #f0f0f0">
          Huawei PR 모니터링 시스템
        </td></tr>
      </table>
    </div>`
}

export async function POST(req: Request) {
  const { slot, slot_date, to, article_ids } = await req.json() as {
    slot: number
    slot_date: string
    to: string[]
    article_ids?: string[]
  }

  if (!slot || !slot_date || !to?.length) {
    return NextResponse.json({ error: 'slot, slot_date, to 필수' }, { status: 400 })
  }

  const supabase = createServiceClient()

  let query = supabase
    .from('daily_alert_articles')
    .select('title, link, pub_date, media, category')
    .eq('slot_date', slot_date)
    .eq('slot', slot)
    .order('pub_date', { ascending: false })

  if (article_ids?.length) {
    query = query.in('id', article_ids)
  } else {
    query = query.eq('excluded', false).limit(MAX_ARTICLES)
  }

  const { data: articles, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!articles || articles.length === 0) {
    return NextResponse.json({ error: '발송할 기사 없음' }, { status: 400 })
  }

  const subject = buildSubject(slot, slot_date)
  const html = buildHtml(articles)

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
    to: to.join(', '),
    bcc: 'pr2ace1@gmail.com',
    subject: `[재발송] ${subject}`,
    html,
  })

  return NextResponse.json({ success: true, articleCount: articles.length, to })
}
