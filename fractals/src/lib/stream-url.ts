import { api } from '@/lib/api'

export async function resolveStreamUrl(item: {
  id: string
  _streamId?: string
  _serverUrl?: string
  _username?: string
  _password?: string
  _extension?: string
}): Promise<string | null> {
  if (item._streamId && item._serverUrl && item._username && item._password) {
    const base = item._serverUrl.replace(/\/$/, '')
    return `${base}/series/${encodeURIComponent(item._username)}/${encodeURIComponent(item._password)}/${item._streamId}.${item._extension ?? 'mkv'}`
  }
  const res: any = await api.content.getStreamUrl({ contentId: item.id })
  return res?.url ?? null
}

export async function copyStreamUrl(item: Parameters<typeof resolveStreamUrl>[0]): Promise<boolean> {
  const url = await resolveStreamUrl(item)
  if (!url) return false
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}
