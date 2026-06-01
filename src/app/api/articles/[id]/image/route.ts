import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import sharp from 'sharp'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp']
  if (!allowedExts.includes(ext)) {
    return NextResponse.json({ error: '지원하지 않는 파일 형식입니다 (jpg, png, gif, webp)' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const inputBuffer = Buffer.from(arrayBuffer)

  // WebP로 변환 (최대 1200px, 품질 85)
  const buffer = await sharp(inputBuffer)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()

  const fileName = `articles/${id}/${Date.now()}.webp`

  // Supabase Storage에 업로드 (버킷: article-images)
  const { error: uploadError } = await supabase.storage
    .from('article-images')
    .upload(fileName, buffer, {
      contentType: 'image/webp',
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // Public URL 가져오기
  const { data: { publicUrl } } = supabase.storage
    .from('article-images')
    .getPublicUrl(fileName)

  // article의 image_url 업데이트
  const { data, error } = await supabase
    .from('articles')
    .update({ image_url: publicUrl })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  // 기존 image_url 확인
  const { data: article } = await supabase
    .from('articles')
    .select('image_url')
    .eq('id', id)
    .single()

  if (article?.image_url) {
    // Storage에서 파일명 추출 후 삭제
    const url = new URL(article.image_url)
    const pathParts = url.pathname.split('/article-images/')
    if (pathParts.length > 1) {
      await supabase.storage.from('article-images').remove([pathParts[1]])
    }
  }

  const { data, error } = await supabase
    .from('articles')
    .update({ image_url: null })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
