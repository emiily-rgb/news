import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

// 2026년 한국 공휴일 + 대체공휴일
const HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-01-28', '2026-01-29', '2026-01-30',
  '2026-03-01', '2026-03-02',
  '2026-05-05', '2026-05-25',
  '2026-06-03',
  '2026-07-17',
  '2026-08-15',
  '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-09',
  '2026-12-25',
])

function getKstDateStr(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function isNonWorkingDay(dateStr: string): boolean {
  if (HOLIDAYS_2026.has(dateStr)) return true
  const dow = new Date(dateStr + 'T09:00:00+09:00').getUTCDay()
  return dow === 0 || dow === 6
}

function isPublicHoliday(dateStr: string): boolean {
  return HOLIDAYS_2026.has(dateStr)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T09:00:00+09:00')
  d.setDate(d.getDate() + n)
  return getKstDateStr(d)
}

// 내일부터 연속 휴일 수 계산, 그 중 공휴일 포함 여부 반환
function getUpcomingHolidayStretch(todayStr: string): { days: number; hasPublicHoliday: boolean } | null {
  const tomorrowStr = addDays(todayStr, 1)
  if (!isNonWorkingDay(tomorrowStr)) return null

  let days = 0
  let hasPublicHoliday = false
  let cursor = tomorrowStr

  while (isNonWorkingDay(cursor)) {
    days++
    if (isPublicHoliday(cursor)) hasPublicHoliday = true
    cursor = addDays(cursor, 1)
    if (days > 14) break // 무한루프 방지
  }

  // 3일 이상이거나, 공휴일이 포함된 경우에만 알림
  if (days >= 3 || hasPublicHoliday) return { days, hasPublicHoliday }
  return null
}

export async function GET() {
  const todayStr = getKstDateStr(new Date())

  // 오늘이 휴일이면 알림 불필요 (영업일에만 실행)
  if (isNonWorkingDay(todayStr)) {
    return NextResponse.json({ skipped: true, reason: '오늘 휴일' })
  }

  const stretch = getUpcomingHolidayStretch(todayStr)
  if (!stretch) {
    return NextResponse.json({ skipped: true, reason: '내일 정상 영업일' })
  }

  const { days, hasPublicHoliday } = stretch
  const label = hasPublicHoliday ? '연휴' : '연휴(주말 포함)'

  const subject = `[화웨이 CSV] 내일부터 ${days}일 ${label} — CSV 다운로드 필요`
  const html = `
    <div style="font-family:sans-serif;max-width:480px;padding:24px">
      <h2 style="margin:0 0 12px">📅 ${label} 전날 알림</h2>
      <p style="margin:0 0 8px">내일부터 <strong>${days}일</strong> ${label}입니다.</p>
      <p style="margin:0 0 20px">화웨이 CSV를 미리 다운로드해 두세요.<br>
      연휴 중 기사 누락이 없으려면 <strong>최소 이틀에 한 번</strong> 다운로드가 필요합니다.</p>
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-app.vercel.app'}/api/huawei-csv"
         style="display:inline-block;background:#0070f3;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
        CSV 다운로드
      </a>
    </div>
  `

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `"Huawei PR Monitoring" <${process.env.GMAIL_USER}>`,
    to: 'euny0320@gmail.com',
    subject,
    html,
  })

  console.log(`[holiday-alert] 발송 완료: ${days}일 ${label}`)
  return NextResponse.json({ sent: true, days, label })
}
