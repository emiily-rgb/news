import { NextRequest, NextResponse } from 'next/server'
import { getConfig, saveConfig } from '@/lib/config'

export async function GET() {
  const config = await getConfig()
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  await saveConfig(body)
  return NextResponse.json({ ok: true })
}
