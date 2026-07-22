import { createServiceClient } from '@/lib/supabase/server'
import { DOMAIN_MAP, type MediaInfo } from '@/lib/domains'

// 런타임 중 이미 조회한 도메인은 재조회하지 않도록 캐싱 (한 번의 수집 실행 내에서만 유효)
const runtimeCache = new Map<string, MediaInfo | null>()

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * 도메인 → 매체 정보 조회.
 * 1) 코드에 미리 등록된 DOMAIN_MAP
 * 2) DB(media_domains)에 이미 등록된 도메인 (status='excluded'면 null 반환 → 기사 제외)
 * 3) 둘 다 없으면 도메인명을 임시 매체명으로 삼아 DB에 'pending'으로 자동 등록하고, 기사는 포함시킨다.
 */
export async function resolveMedia(url: string): Promise<MediaInfo | null> {
  const hostname = extractHostname(url)
  if (!hostname) return null

  for (const [domain, info] of Object.entries(DOMAIN_MAP)) {
    if (hostname === domain || hostname.endsWith('.' + domain)) return info
  }

  if (runtimeCache.has(hostname)) return runtimeCache.get(hostname)!

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('media_domains')
    .select('domain, company, media_type, status')
    .eq('domain', hostname)
    .maybeSingle()

  if (data) {
    const result: MediaInfo | null = data.status === 'excluded'
      ? null
      : { company: data.company, mediaType: data.media_type }
    runtimeCache.set(hostname, result)
    return result
  }

  const placeholder: MediaInfo = { company: hostname, mediaType: 'Unknown' }
  runtimeCache.set(hostname, placeholder)
  // 동시 요청으로 인한 중복 삽입은 무시 (도메인이 PK이므로 충돌 시 무시)
  await supabase
    .from('media_domains')
    .upsert(
      { domain: hostname, company: hostname, media_type: 'Unknown', status: 'pending' },
      { onConflict: 'domain', ignoreDuplicates: true }
    )
  return placeholder
}
