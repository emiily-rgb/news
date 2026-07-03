import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/server'

// 계정별 발신 설정. 로그인 이메일이 여기 없으면 기본 GMAIL_USER로 발송한다.
const SENDER_ACCOUNTS: Record<string, { transport: () => nodemailer.Transporter; user: string; passEnv: string }> = {
  'pr2ace@pr2ace.com': {
    user: 'pr2ace@pr2ace.com',
    passEnv: 'PR2ACE_SMTP_PASS',
    transport: () => nodemailer.createTransport({
      host: process.env.PR2ACE_SMTP_HOST || 'smtps.hiworks.com',
      port: Number(process.env.PR2ACE_SMTP_PORT) || 465,
      secure: (process.env.PR2ACE_SMTP_SECURE ?? 'true') === 'true',
      auth: {
        user: 'pr2ace@pr2ace.com',
        pass: process.env.PR2ACE_SMTP_PASS,
      },
    }),
  },
}

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
  const { runId, recipients, subject, html, senderEmail } = await req.json()

  const matchedAccount = senderEmail ? SENDER_ACCOUNTS[senderEmail.toLowerCase()] : undefined
  // 매칭된 발신 계정의 설정(SMTP 비밀번호)이 없으면 기본 Gmail 발신자로 대체한다.
  const senderAccount = matchedAccount && process.env[matchedAccount.passEnv] ? matchedAccount : undefined

  if (!senderAccount && (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD)) {
    return NextResponse.json({ error: 'Gmail 설정이 되지 않았습니다.' }, { status: 500 })
  }
  if (!recipients || recipients.length === 0) {
    return NextResponse.json({ error: '수신자가 없습니다. 설정에서 수신자를 추가해주세요.' }, { status: 400 })
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'Huawei PR 모니터링'
  const from = senderAccount ? `"${fromName}" <${senderAccount.user}>` : `"${fromName}" <${process.env.GMAIL_USER}>`

  try {
    const transporter = senderAccount ? senderAccount.transport() : getTransporter()
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
          sent_by: senderAccount ? senderAccount.user : process.env.GMAIL_USER,
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
