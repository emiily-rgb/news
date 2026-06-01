import { Config, DEFAULT_CONFIG } from '@/types'
import { createServiceClient } from './supabase/server'

export async function getConfig(): Promise<Config> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('configs')
      .select('value')
      .eq('key', 'main')
      .single()
    return { ...DEFAULT_CONFIG, ...(data?.value ?? {}) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('configs').upsert({ key: 'main', value: config })
}
