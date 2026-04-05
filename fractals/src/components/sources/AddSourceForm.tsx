import { useState } from 'react'
import { api } from '@/lib/api'

interface Props {
  onAdded: () => void
  onCancel: () => void
}

type Step = 'form' | 'testing' | 'tested' | 'syncing' | 'done' | 'error'

interface TestResult {
  success: boolean
  itemCount?: number
  error?: string
}

export function AddSourceForm({ onAdded, onCancel }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState({ name: '', serverUrl: '', username: '', password: '' })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [syncMessage, setSyncMessage] = useState('')
  const [error, setError] = useState('')

  const canAdd = step === 'tested' && testResult?.success === true

  const handleTest = async () => {
    if (!form.serverUrl || !form.username || !form.password) return
    setStep('testing')
    setTestResult(null)
    setError('')
    try {
      const result = await api.sources.testXtream({
        serverUrl: form.serverUrl,
        username: form.username,
        password: form.password,
      })
      if (result.success) {
        setTestResult({ success: true, itemCount: (result as any).itemCount })
        setStep('tested')
      } else {
        setTestResult({ success: false, error: (result as any).error ?? 'Connection failed' })
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
    setSyncMessage('Adding source…')
    setError('')

    const name =
      form.name.trim() ||
      (() => {
        try {
          return new URL(form.serverUrl.startsWith('http') ? form.serverUrl : `http://${form.serverUrl}`).hostname
        } catch {
          return form.serverUrl
        }
      })()

    const result = await api.sources.addXtream({ ...form, name })

    if (!result.success) {
      setStep('error')
      setError(result.error ?? 'Failed to add source')
      return
    }

    setSyncMessage('Starting sync…')

    const unsub = api.on('sync:progress', (progress: any) => {
      setSyncMessage(progress.message ?? '')
      if (progress.phase === 'done' || progress.phase === 'error') {
        unsub()
        if (progress.phase === 'done') {
          setStep('done')
          setTimeout(() => onAdded(), 800)
        } else {
          setStep('error')
          setError(progress.message ?? 'Sync failed')
        }
      }
    })

    api.sources.sync(result.sourceId!)
  }

  const resetForm = () => {
    setStep('form')
    setTestResult(null)
    setError('')
    setSyncMessage('')
  }

  const formChanged = () => {
    // If user edits fields after a test, reset test result
    setTestResult(null)
    if (step === 'tested' || step === 'error') setStep('form')
  }

  return (
    <div style={{
      marginTop: 12,
      padding: '16px',
      background: 'var(--bg-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', margin: '0 0 14px 0' }}>
        Add Xtream Codes Source
      </p>

      {/* M3U notice */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 14,
        padding: '8px 10px', borderRadius: 6,
        background: 'var(--bg-3)', border: '1px solid var(--border-subtle)',
      }}>
        <button
          disabled
          style={{
            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: 'var(--bg-1)', color: 'var(--text-2)',
            border: '1px solid var(--border-default)', cursor: 'default',
            opacity: 0.6,
          }}
        >
          Xtream Codes
        </button>
        <button
          disabled
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
            background: 'transparent', color: 'var(--text-3)',
            border: '1px solid var(--border-subtle)', cursor: 'not-allowed',
          }}
        >
          M3U URL
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
            padding: '1px 4px', borderRadius: 3,
            background: 'var(--accent-warning)', color: '#000',
            textTransform: 'uppercase',
          }}>
            soon
          </span>
        </button>
      </div>

      {/* Form fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FormField
          label="Name"
          placeholder="My IPTV (auto-detected if blank)"
          value={form.name}
          onChange={(v) => { setForm(f => ({ ...f, name: v })); formChanged() }}
        />
        <FormField
          label="Server URL"
          placeholder="http://provider.example.com:8080"
          value={form.serverUrl}
          onChange={(v) => { setForm(f => ({ ...f, serverUrl: v })); formChanged() }}
          required
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField
            label="Username"
            placeholder="username"
            value={form.username}
            onChange={(v) => { setForm(f => ({ ...f, username: v })); formChanged() }}
            required
          />
          <FormField
            label="Password"
            placeholder="password"
            type="password"
            value={form.password}
            onChange={(v) => { setForm(f => ({ ...f, password: v })); formChanged() }}
            required
          />
        </div>

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

        {/* Sync progress */}
        {(step === 'syncing') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner />
              <span style={{ fontSize: 11, color: 'var(--text-1)' }}>
                {syncMessage || 'Syncing…'}
              </span>
            </div>
          </div>
        )}

        {/* Done state */}
        {step === 'done' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px',
            borderRadius: 6, background: 'color-mix(in srgb, var(--accent-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent-success) 25%, transparent)',
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-success)', flexShrink: 0 }}>
              <path d="M2 7l4 4 6-6" />
            </svg>
            <span style={{ fontSize: 11, color: 'var(--accent-success)', fontWeight: 500 }}>
              Sync complete!
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
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={step === 'syncing' || step === 'done'}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
              background: 'transparent', border: '1px solid var(--border-default)',
              color: 'var(--text-1)', cursor: 'pointer', transition: 'all 0.1s',
              fontFamily: 'var(--font-ui)',
              opacity: (step === 'syncing' || step === 'done') ? 0.4 : 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-0)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-1)' }}
          >
            Cancel
          </button>

          {step === 'error' ? (
            <button
              type="button"
              onClick={resetForm}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                background: 'var(--bg-3)', border: '1px solid var(--border-default)',
                color: 'var(--text-0)', cursor: 'pointer', transition: 'all 0.1s',
                fontFamily: 'var(--font-ui)',
              }}
            >
              Try again
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleTest}
                disabled={!form.serverUrl || !form.username || !form.password || step === 'testing' || step === 'syncing' || step === 'done'}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 500,
                  background: 'var(--bg-3)', border: '1px solid var(--border-default)',
                  color: 'var(--text-0)', cursor: 'pointer', transition: 'all 0.1s',
                  fontFamily: 'var(--font-ui)',
                  opacity: (!form.serverUrl || !form.username || !form.password || step === 'testing' || step === 'syncing' || step === 'done') ? 0.4 : 1,
                }}
              >
                {step === 'testing' ? 'Testing…' : 'Test'}
              </button>

              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAdd || step === 'syncing' || step === 'done'}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                  background: 'var(--accent-interactive)', border: 'none',
                  color: '#fff', cursor: 'pointer', transition: 'opacity 0.1s',
                  fontFamily: 'var(--font-ui)',
                  opacity: (!canAdd || step === 'syncing' || step === 'done') ? 0.4 : 1,
                }}
                onMouseEnter={(e) => { if (canAdd) e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = (!canAdd || step === 'syncing' || step === 'done') ? '0.4' : '1' }}
              >
                Add
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Field ──────────────────────────────────────────────────────── */
function FormField({
  label, placeholder, value, onChange, type = 'text', required,
}: {
  label: string; placeholder: string; value: string
  onChange: (v: string) => void; type?: string; required?: boolean
}) {
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
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{
          background: 'var(--bg-1)', border: '1px solid var(--border-default)',
          borderRadius: 7, padding: '7px 10px', fontSize: 11,
          color: 'var(--text-0)', caretColor: 'var(--accent-interactive)',
          outline: 'none', fontFamily: 'var(--font-ui)', transition: 'border-color 0.15s',
          width: '100%', boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-interactive)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)' }}
      />
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
