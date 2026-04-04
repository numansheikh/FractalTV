import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'

interface Props {
  onClose: () => void
  onAdded: () => void
}

type Step = 'form' | 'testing' | 'syncing' | 'done' | 'error'

export function AddSourceDialog({ onClose, onAdded }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [error, setError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [form, setForm] = useState({ name: '', serverUrl: '', username: '', password: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.serverUrl || !form.username || !form.password) return

    setStep('testing')
    setError('')

    const name =
      form.name.trim() ||
      new URL(form.serverUrl.startsWith('http') ? form.serverUrl : `http://${form.serverUrl}`)
        .hostname

    const result = await api.sources.addXtream({ ...form, name })

    if (!result.success) {
      setStep('error')
      setError(result.error ?? 'Connection failed')
      return
    }

    setStep('syncing')
    setSyncMessage('Starting sync…')

    const unsub = api.on('sync:progress', (progress: any) => {
      setSyncMessage(progress.message)
      if (progress.phase === 'done' || progress.phase === 'error') {
        unsub()
        if (progress.phase === 'done') {
          setStep('done')
          setTimeout(() => {
            onAdded()
            onClose()
          }, 1000)
        } else {
          setStep('error')
          setError(progress.message)
        }
      }
    })

    api.sources.sync(result.sourceId!)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-sm rounded-xl shadow-2xl"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-strong)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 20px 0' }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Add Xtream Source
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-md p-1 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 20px 20px' }}>
          <AnimatePresence mode="wait">
            {step === 'form' && (
              <motion.form
                key="form"
                onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Field
                  label="Name"
                  placeholder="My IPTV (auto-detected if blank)"
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                />
                <Field
                  label="Server URL"
                  placeholder="http://provider.example.com:8080"
                  value={form.serverUrl}
                  onChange={(v) => setForm((f) => ({ ...f, serverUrl: v }))}
                  required
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field
                    label="Username"
                    placeholder="username"
                    value={form.username}
                    onChange={(v) => setForm((f) => ({ ...f, username: v }))}
                    required
                  />
                  <Field
                    label="Password"
                    placeholder="password"
                    type="password"
                    value={form.password}
                    onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 500,
                      background: 'transparent', border: '1px solid var(--color-border-strong)',
                      color: 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.1s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer',
                      transition: 'opacity 0.1s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                  >
                    Connect
                  </button>
                </div>
              </motion.form>
            )}

            {(step === 'testing' || step === 'syncing') && (
              <motion.div
                key="progress"
                className="flex flex-col items-center gap-4 py-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Spinner />
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {step === 'testing' ? 'Testing connection…' : 'Syncing library'}
                  </p>
                  {step === 'syncing' && syncMessage && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {syncMessage}
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {step === 'done' && (
              <motion.div
                key="done"
                className="flex flex-col items-center gap-3 py-6"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ background: 'rgba(74, 222, 128, 0.15)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-success)' }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
                  Sync complete
                </p>
              </motion.div>
            )}

            {step === 'error' && (
              <motion.div
                key="error"
                className="flex flex-col gap-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div
                  className="rounded-lg p-3 text-xs"
                  style={{
                    background: 'rgba(248, 113, 113, 0.08)',
                    color: 'var(--color-error)',
                    border: '1px solid rgba(248, 113, 113, 0.2)',
                    lineHeight: '1.5',
                  }}
                >
                  {error}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="flex-1 rounded-lg py-2 text-xs"
                    style={{
                      background: 'var(--color-card)',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setStep('form')}
                    className="flex-1 rounded-lg py-2 text-xs font-medium"
                    style={{ background: 'var(--color-card-hover)', color: 'var(--color-text-primary)' }}
                  >
                    Try again
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', letterSpacing: '0.01em' }}>
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: 'var(--color-text-primary)',
          caretColor: 'var(--color-primary)',
          outline: 'none',
          fontFamily: 'inherit',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          width: '100%',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-primary)'
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-primary-dim)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border-strong)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      />
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="h-7 w-7 animate-spin rounded-full border-2"
      style={{ borderColor: 'var(--color-primary-dim)', borderTopColor: 'var(--color-primary)' }}
    />
  )
}
