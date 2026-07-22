import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/server'

const REPORT_RECIPIENTS = ['euny0320@gmail.com', 'pr2ace1@gmail.com']

export async function GET() {
  const supabase = createServiceClient()

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: domains, error } = await supabase
    .from('media_domains')
    .select('domain, company, media_type, status, first_seen_at')
    .eq('status', 'pending')
    .gte('first_seen_at', since)
    .order('first_seen_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!domains || domains.length === 0) {
    return NextResponse.json({ ok: true, message: '지난 7일간 신규 미등록 도메인 없음' })
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return NextResponse.json({ error: 'Gmail 설정이 되지 않았습니다.' }, { status: 500 })
  }

  const rows = domains.map(d =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${d.domain}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${new Date(d.first_seen_at).toLocaleDateString('ko-KR')}</td></tr>`
  ).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#c8102e">신규 미등록 도메인 (지난 7일)</h2>
      <p style="color:#666;font-size:13px">아래 도메인은 자동으로 임시 등록되어 브리핑/CSV에 이미 포함되고 있습니다. 매체명을 다듬거나, 제외하고 싶은 도메인이 있으면 알려주세요.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">도메인</th><th style="padding:6px 10px;text-align:left">최초 발견일</th></tr>
        ${rows}
      </table>
    </div>
  `

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Huawei PR 모니터링'}" <${process.env.GMAIL_USER}>`,
    to: REPORT_RECIPIENTS.join(', '),
    subject: `[미등록 도메인 리포트] 신규 ${domains.length}건`,
    html,
  })

  return NextResponse.json({ ok: true, count: domains.length, domains: domains.map(d => d.domain) })
}
