import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { ColorPicker } from './SourceCard'
import { useSourcesStore } from '@/stores/sources.store'

interface Props {
  onAdded: (sourceId: string) => void
  onCancel: () => void
}

type SourceMode = 'xtream' | 'm3u'
type M3uInputMode = 'url' | 'file'
type Step = 'form' | 'testing' | 'tested' | 'syncing' | 'done' | 'error'

interface TestResult {
  success: boolean
  itemCount?: number
  error?: string
}

export function AddSourceModal({ onAdded, onCancel }: Props) {
  const [mode, setMode] = useState<SourceMode>('xtream')
  const [m3uInput, setM3uInput] = useState<M3uInputMode>('url')
  const [step, setStep] = useState<Step>('form')
  const [xtreamForm, setXtreamForm] = useState({ name: '', protocol: 'http' as 'http' | 'https', host: '', port: '8080', username: '', password: '' })
  const [m3uForm, setM3uForm] = useState({ name: '', m3uUrl: '', filePath: '' })
  const [colorIndex, setColorIndex] = useState<number>(() => useSourcesStore.getState().sources.length % 8)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [syncMessage, setSyncMessage] = useState('')
  const [error, setError] = useState('')

  const sourceCount = useSourcesStore(s => s.sources.length)

  // Escape to close (capture phase so it doesn't leak)
  // During syncing: Escape = run in background (dismiss, keep syncing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (step === 'done') return
        onCancel()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [step, onCancel])

  /** Assemble full server URL from parts */
  const serverUrl = `${xtreamForm.protocol}://${xtreamForm.host.trim()}${xtreamForm.port ? ':' + xtreamForm.port : ''}`

  /** Smart paste: split a full URL into protocol/host/port parts */
  const handleHostChange = (raw: string) => {
    const s = raw.trim().replace(/\/+/g, '')  // strip all slashes
    // protocol present — "https://host:port", "https:host:port", "http:host", etc.
    const protoMatch = s.match(/^(https?):?([^:]+)(?::(\d+))?$/i)
    if (protoMatch) {
      setXtreamForm(f => ({
        ...f,
        protocol: protoMatch[1].toLowerCase() as 'http' | 'https',
        host: protoMatch[2],
        port: protoMatch[3] || f.port,
      }))
    } else if (/:\d+$/.test(s)) {
      // bare host:port like "otv.to:8080"
      const idx = s.lastIndexOf(':')
      setXtreamForm(f => ({ ...f, host: s.slice(0, idx), port: s.slice(idx + 1) || f.port }))
    } else {
      setXtreamForm(f => ({ ...f, host: s }))
    }
    formChanged()
  }

  const m3uValue = m3uInput === 'file' ? m3uForm.filePath : m3uForm.m3uUrl

  const canTest = mode === 'xtream'
    ? !!(xtreamForm.host.trim() && xtreamForm.username && xtreamForm.password)
    : !!m3uValue

  const canAdd = step === 'tested' && testResult?.success === true

  const handleTest = async () => {
    if (!canTest) return
    setStep('testing')
    setTestResult(null)
    setError('')
    try {
      if (mode === 'xtream') {
        const result = await api.sources.testXtream({
          serverUrl,
          username: xtreamForm.username,
          password: xtreamForm.password,
        })
        if (result.success) {
          setTestResult({ success: true, itemCount: (result as any).itemCount })
        } else {
          setTestResult({ success: false, error: (result as any).error ?? 'Connection failed' })
        }
        setStep('tested')
      } else {
        const result = await api.sources.testM3u({ m3uUrl: m3uValue })
        if (result.error) {
          setTestResult({ success: false, error: result.error })
        } else {
          setTestResult({ success: true, itemCount: result.count })
        }
        setStep('tested')
      }
    } catch (e) {
      setTestResult({ success: false, error: String(e) })
      setStep('tested')
    }
  }

  const handleAdd = async () => {
    if (!canAdd) return
    setStep('syncing')
    setSyncMessage('Connecting…')
    setError('')

    let sourceId: string | undefined

    if (mode === 'xtream') {
      const name = xtreamForm.name.trim() || xtreamForm.host.trim() || 'Xtream Source'

      const result = await api.sources.addXtream({
        name,
        serverUrl,
        username: xtreamForm.username,
        password: xtreamForm.password,
      })
      if (!result.success) {
        setStep('error')
        setError(result.error ?? 'Failed to add source')
        return
      }
      sourceId = result.sourceId!
    } else {
      const name =
        m3uForm.name.trim() ||
        (() => {
          if (m3uInput === 'file') {
            const parts = m3uForm.filePath.split(/[/\\]/)
            return parts[parts.length - 1]?.replace(/\.(m3u8?|txt)$/i, '') || 'M3U Playlist'
          }
          try { return new URL(m3uForm.m3uUrl).hostname } catch { return 'M3U Playlist' }
        })()

      const result = await api.sources.addM3u({ name, m3uUrl: m3uValue })
      if (result.error) {
        setStep('error')
        setError(result.error)
        return
      }
      sourceId = result.id
    }

    if (!sourceId) {
      setStep('error')
      setError('Failed to create source')
      return
    }

    await api.sources.setColor(sourceId, colorIndex)
    // Close form — sync progress continues on the source card
    onAdded(sourceId)
  }

  const handleBrowseFile = async () => {
    const result = await api.dialog.openFile({
      filters: [
        { name: 'M3U Playlists', extensions: ['m3u', 'm3u8', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!result.canceled && result.filePath) {
      setM3uForm(f => ({ ...f, filePath: result.filePath! }))
      formChanged()
    }
  }

  const resetForm = () => {
    setStep('form')
    setTestResult(null)
    setError('')
    setSyncMessage('')
    setColorIndex(sourceCount)
  }

  const formChanged = () => {
    setTestResult(null)
    if (step === 'tested' || step === 'error') setStep('form')
  }

  const switchMode = (m: SourceMode) => {
    if (step === 'done') return
    setMode(m)
    resetForm()
  }

  const isBusy = step === 'done'

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !isBusy) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 440,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        padding: '20px 24px 24px',
        background: 'var(--bg-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)', fontFamily: 'var(--font-ui)' }}>
            Add Source
          </span>
          <button
            onClick={onCancel}
            disabled={isBusy}
            style={{
              width: 26, height: 26, borderRadius: 6, border: 'none',
              background: 'transparent', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-2)', cursor: 'pointer',
              transition: 'background 0.1s, color 0.1s',
              opacity: isBusy ? 0.3 : 1,
            }}
            onMouseEnter={(e) => { if (!isBusy) { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-1)' } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)' }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div style={{
          display: 'flex', gap: 8, marginBottom: 16,
          padding: '6px 8px', borderRadius: 6,
          background: 'var(--bg-2)', border: '1px solid var(--border-subtle)',
        }}>
          <TabBtn label="Xtream Codes" active={mode === 'xtream'} disabled={isBusy} onClick={() => switchMode('xtream')} />
          <TabBtn label="M3U Playlist" active={mode === 'm3u'} disabled={isBusy} onClick={() => switchMode('m3u')} />
        </div>

        {/* Form fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormField
            label="Name"
            placeholder={mode === 'xtream' ? 'My IPTV (auto-detected if blank)' : 'My Playlist (auto-detected if blank)'}
            value={mode === 'xtream' ? xtreamForm.name : m3uForm.name}
            onChange={(v) => {
              if (mode === 'xtream') setXtreamForm(f => ({ ...f, name: v }))
              else setM3uForm(f => ({ ...f, name: v }))
              formChanged()
            }}
          />

          {/* Color picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-ui)' }}>
              Color
            </label>
            <ColorPicker selected={colorIndex} onPick={setColorIndex} />
          </div>

          {mode === 'xtream' ? (
            <>
              {/* Server — 3-part: protocol pills | host | port */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  fontFamily: 'var(--font-ui)',
                }}>
                  Server <span style={{ color: 'var(--accent-danger)', marginLeft: 2 }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {/* Protocol pills */}
                  <div style={{
                    display: 'flex', borderRadius: 6, overflow: 'hidden',
                    border: '1px solid var(--border-default)', flexShrink: 0,
                  }}>
                    {(['http', 'https'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => { setXtreamForm(f => ({ ...f, protocol: p })); formChanged() }}
                        style={{
                          padding: '4px 6px', fontSize: 9, fontWeight: 600,
                          fontFamily: 'var(--font-ui)', border: 'none', cursor: 'pointer',
                          background: xtreamForm.protocol === p ? 'color-mix(in srgb, var(--accent-interactive) 50%, var(--bg-0))' : 'var(--bg-0)',
                          color: xtreamForm.protocol === p ? '#fff' : 'var(--text-3)',
                          transition: 'all 0.1s',
                        }}
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {/* Host input */}
                  <input
                    type="text"
                    placeholder="provider.example.com"
                    value={xtreamForm.host}
                    onChange={(e) => handleHostChange(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0,
                      background: 'var(--bg-0)', border: '1px solid var(--border-default)',
                      borderRadius: 7, padding: '7px 10px', fontSize: 11,
                      color: 'var(--text-0)', caretColor: 'var(--accent-interactive)',
                      outline: 'none', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
                  />
                  {/* Port input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>:</span>
                    <input
                      type="text"
                      placeholder="port"
                      value={xtreamForm.port}
                      onChange={(e) => { setXtreamForm(f => ({ ...f, port: e.target.value.replace(/\D/g, '') })); formChanged() }}
                      style={{
                        width: 52,
                        background: 'var(--bg-0)', border: '1px solid var(--border-default)',
                        borderRadius: 7, padding: '7px 6px', fontSize: 11,
                        color: 'var(--text-0)', caretColor: 'var(--accent-interactive)',
                        outline: 'none', fontFamily: 'var(--font-mono)', transition: 'border-color 0.15s',
                        textAlign: 'center',
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <FormField
                  label="Username"
                  placeholder="username"
                  value={xtreamForm.username}
                  onChange={(v) => { setXtreamForm(f => ({ ...f, username: v })); formChanged() }}
                  required
                />
                <FormField
                  label="Password"
                  placeholder="password"
                  type="password"
                  value={xtreamForm.password}
                  onChange={(v) => { setXtreamForm(f => ({ ...f, password: v })); formChanged() }}
                  required
                />
              </div>
            </>
          ) : (
            <>
              {/* M3U sub-tabs: URL vs File */}
              <div style={{ display: 'flex', gap: 6, marginBottom: -4 }}>
                <SubTabBtn label="URL" active={m3uInput === 'url'} onClick={() => { setM3uInput('url'); formChanged() }} />
                <SubTabBtn label="Local File" active={m3uInput === 'file'} onClick={() => { setM3uInput('file'); formChanged() }} />
              </div>

              {m3uInput === 'url' ? (
                <FormField
                  label="M3U URL"
                  placeholder="http://example.com/playlist.m3u"
                  value={m3uForm.m3uUrl}
                  onChange={(v) => { setM3uForm(f => ({ ...f, m3uUrl: v })); formChanged() }}
                  required
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    fontFamily: 'var(--font-ui)',
                  }}>
                    M3U File <span style={{ color: 'var(--accent-danger)', marginLeft: 2 }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      onClick={handleBrowseFile}
                      style={{
                        padding: '7px 14px', borderRadius: 7, fontSize: 11, fontWeight: 500,
                        background: 'var(--bg-2)', border: '1px solid var(--border-default)',
                        color: 'var(--text-0)', cursor: 'pointer',
                        fontFamily: 'var(--font-ui)', flexShrink: 0,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
                    >
                      Browse…
                    </button>
                    <span style={{
                      fontSize: 11, color: m3uForm.filePath ? 'var(--text-1)' : 'var(--text-3)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-mono)',
                      direction: 'rtl', textAlign: 'left', // show end of path
                    }}>
                      {m3uForm.filePath
                        ? m3uForm.filePath.split(/[/\\]/).slice(-2).join('/')
                        : 'No file selected'}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Test result feedback */}
          {step === 'tested' && testResult && (
            <div style={{
              padding: '8px 10px', borderRadius: 6, fontSize: 11,
              background: testResult.success
                ? 'color-mix(in srgb, var(--accent-success) 10%, transparent)'
                : 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
              border: `1px solid color-mix(in srgb, ${testResult.success ? 'var(--accent-success)' : 'var(--accent-danger)'} 25%, transparent)`,
              color: testResult.success ? 'var(--accent-success)' : 'var(--accent-danger)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {testResult.success ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                  Connection successful
                  {testResult.itemCount !== undefined && (
                    <span style={{ color: 'var(--text-1)', marginLeft: 4 }}>
                      · {testResult.itemCount.toLocaleString()} items
                    </span>
                  )}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 1l10 10M11 1L1 11" />
                  </svg>
                  {testResult.error ?? 'Connection failed'}
                </>
              )}
            </div>
          )}

          {/* Adding progress (brief — form closes once source is inserted) */}
          {step === 'syncing' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner />
              <span style={{ fontSize: 11, color: 'var(--text-1)' }}>
                {syncMessage || 'Connecting…'}
              </span>
            </div>
          )}

          {/* Error state */}
          {step === 'error' && error && (
            <div style={{
              padding: '8px 10px', borderRadius: 6, fontSize: 11,
              background: 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-danger) 25%, transparent)',
              color: 'var(--accent-danger)', lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {step === 'syncing' ? (
              <button
                type="button"
                disabled
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                  background: 'transparent', border: '1px solid var(--border-default)',
                  color: 'var(--text-2)', cursor: 'default',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                Adding…
              </button>
            ) : step === 'error' ? (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                    background: 'transparent', border: '1px solid var(--border-default)',
                    color: 'var(--text-1)', cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                    background: 'var(--bg-3)', border: '1px solid var(--border-default)',
                    color: 'var(--text-0)', cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={step === 'done'}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                    background: 'transparent', border: '1px solid var(--border-default)',
                    color: 'var(--text-1)', cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                    opacity: step === 'done' ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-0)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-1)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!canTest || step === 'testing'}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                    background: 'var(--bg-3)', border: '1px solid var(--border-default)',
                    color: 'var(--text-0)', cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                    opacity: (!canTest || step === 'testing') ? 0.4 : 1,
                  }}
                >
                  {step === 'testing' ? 'Testing…' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!canAdd}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                    background: 'var(--accent-interactive)', border: 'none',
                    color: '#fff', cursor: 'pointer', transition: 'opacity 0.1s',
                    fontFamily: 'var(--font-ui)',
                    opacity: !canAdd ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => { if (canAdd) e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = !canAdd ? '0.4' : '1' }}
                >
                  Add
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Keep old name as alias for backward compat
export const AddSourceForm = AddSourceModal

/* ── Tab button ────────────────────────────────────────────────── */
function TabBtn({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 600,
        background: active ? 'var(--bg-0)' : 'transparent',
        color: active ? 'var(--text-0)' : 'var(--text-2)',
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.12s',
        fontFamily: 'var(--font-ui)',
      }}
    >
      {label}
    </button>
  )
}

/* ── Sub-tab button (URL / File toggle) ────────────────────────── */
function SubTabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        background: active ? 'var(--accent-interactive)' : 'transparent',
        color: active ? '#fff' : 'var(--text-2)',
        border: 'none', cursor: 'pointer',
        transition: 'all 0.12s',
        fontFamily: 'var(--font-ui)',
      }}
    >
      {label}
    </button>
  )
}

/* ── Field ──────────────────────────────────────────────────────── */
function FormField({
  label, placeholder, value, onChange, type = 'text', required,
}: {
  label: string; placeholder: string; value: string
  onChange: (v: string) => void; type?: string; required?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
        letterSpacing: '0.04em', textTransform: 'uppercase',
        fontFamily: 'var(--font-ui)',
      }}>
        {label}
        {required && <span style={{ color: 'var(--accent-danger)', marginLeft: 2 }}>*</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={isPassword && !revealed ? 'password' : 'text'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          style={{
            background: 'var(--bg-0)', border: '1px solid var(--border-default)',
            borderRadius: 7, padding: '7px 10px', fontSize: 11,
            paddingRight: isPassword ? 30 : 10,
            color: 'var(--text-0)', caretColor: 'var(--accent-interactive)',
            outline: 'none', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s',
            width: '100%', boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setRevealed(r => !r)}
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: revealed ? 'var(--text-1)' : 'var(--text-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {revealed ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Spinner ────────────────────────────────────────────────────── */
function Spinner() {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: '50%',
      border: '2px solid var(--bg-4)',
      borderTopColor: 'var(--accent-interactive)',
      flexShrink: 0,
      animation: 'spin 0.7s linear infinite',
    }} />
  )
}
