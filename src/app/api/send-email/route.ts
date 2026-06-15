import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/server'

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}


export async function POST(req: NextRequest) {
  const { runId, recipients, subject, html } = await req.json()

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return NextResponse.json({ error: 'Gmail 설정이 되지 않았습니다.' }, { status: 500 })
  }
  if (!recipients || recipients.length === 0) {
    return NextResponse.json({ error: '수신자가 없습니다. 설정에서 수신자를 추가해주세요.' }, { status: 400 })
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'Huawei PR 모니터링'
  const from = `"${fromName}" <${process.env.GMAIL_USER}>`

  try {
    const transporter = getTransporter()
    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      bcc: 'pr2ace1@gmail.com',
      subject,
      html,
    })

    const now = new Date().toISOString()
    if (runId) {
      const supabase = createServiceClient()
      await supabase
        .from('run_logs')
        .update({
          sent_at: now,
          sent_by: process.env.GMAIL_USER,
          recipients,
          draft_saved_at: now,
        })
        .eq('id', runId)
    }

    return NextResponse.json({ success: true, draft_saved_at: now })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
