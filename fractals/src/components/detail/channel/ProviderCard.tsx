interface Props {
  tvgId?: string
  epgChannelId?: string
}

export function ProviderCard({ tvgId, epgChannelId }: Props) {
  if (!tvgId && !epgChannelId) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{
        fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--text-3)',
        margin: 0, fontFamily: 'var(--font-ui)',
      }}>
        Provider stream
      </p>
      {tvgId && <MetaRow label="tvg-id" value={String(tvgId)} />}
      {epgChannelId && epgChannelId !== tvgId && (
        <MetaRow label="EPG channel" value={String(epgChannelId)} />
      )}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{
        fontSize: 11, color: 'var(--text-1)',
        fontFamily: 'var(--font-mono)',
        minWidth: 90,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, color: 'var(--text-0)',
        fontFamily: 'var(--font-mono)',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  )
}
