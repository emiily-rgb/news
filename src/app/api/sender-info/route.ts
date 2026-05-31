import { NextResponse } from 'next/server'

export async function GET() {
  const user = process.env.GMAIL_USER
  if (!user || !process.env.GMAIL_APP_PASSWORD) {
    return NextResponse.json(null)
  }
  return NextResponse.json({
    name: process.env.EMAIL_FROM_NAME || 'Huawei PR 모니터링',
    address: user,
  })
}
