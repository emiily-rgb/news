import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase/server'
import { buildEmailHtml } from '@/services/emailBuilder'
import type { Article, RunLog } from '@/types'

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
  const { runId, recipients, subject, html: clientHtml, senderEmail } = await req.json()

  // 클라이언트가 보낸 html은 신뢰하지 않는다 (오래된 브라우저 캐시로 구버전 템플릿을 계산해 보낼 수 있음).
  // runId가 있으면 항상 서버에서 최신 코드로 다시 렌더링해서 발송한다.
  let html = clientHtml
  if (runId) {
    const supabase = createServiceClient()
    const [{ data: runLog }, { data: articles }, { data: configRow }] = await Promise.all([
      supabase.from('run_logs').select('*').eq('id', runId).single(),
      supabase.from('articles').select('*').eq('run_id', runId).order('order_index'),
      supabase.from('configs').select('value').eq('key', 'main').single(),
    ])
    if (runLog && articles) {
      const mediaDisplay = (configRow?.value as { media_display?: Record<string, string> } | undefined)?.media_display ?? {}
      html = buildEmailHtml(articles as Article[], runLog as RunLog, mediaDisplay)
    }
  }

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
