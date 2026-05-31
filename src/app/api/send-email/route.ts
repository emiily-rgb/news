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

// HTML에서 img src URL 추출 후 CID 첨부로 교체
async function embedImages(html: string): Promise<{
  html: string
  attachments: { filename: string; content: Buffer; cid: string; contentType: string }[]
}> {
  const attachments: { filename: string; content: Buffer; cid: string; contentType: string }[] = []
  const imgRegex = /<img[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi
  const urls = new Set<string>()
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    urls.add(match[1])
  }

  const urlToCid = new Map<string, string>()

  await Promise.all(
    [...urls].map(async (url, i) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
        })
        clearTimeout(timeout)
        if (!res.ok) return

        const contentType = res.headers.get('content-type') || 'image/jpeg'
        if (!contentType.startsWith('image/')) return

        const buffer = Buffer.from(await res.arrayBuffer())
        const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg'
        const cid = `img${i}@huawei-news`
        const filename = `image${i}.${ext}`

        attachments.push({ filename, content: buffer, cid, contentType })
        urlToCid.set(url, cid)
      } catch {
        // 이미지 다운로드 실패 시 그냥 건너뜀
      }
    })
  )

  // HTML의 img src를 cid: 로 교체
  let embeddedHtml = html
  for (const [url, cid] of urlToCid.entries()) {
    embeddedHtml = embeddedHtml.split(url).join(`cid:${cid}`)
  }

  return { html: embeddedHtml, attachments }
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
    // 이미지를 CID 첨부로 변환
    const { html: embeddedHtml, attachments } = await embedImages(html)

    const transporter = getTransporter()
    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject,
      html: embeddedHtml,
      attachments,
    })

    if (runId) {
      const supabase = createServiceClient()
      await supabase
        .from('run_logs')
        .update({
          sent_at: new Date().toISOString(),
          sent_by: process.env.GMAIL_USER,
          recipients,
        })
        .eq('id', runId)
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
