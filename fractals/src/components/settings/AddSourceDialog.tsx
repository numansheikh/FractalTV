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

    // Derive name from URL if not provided
    const name = form.name.trim() || new URL(form.serverUrl.startsWith('http') ? form.serverUrl : `http://${form.serverUrl}`).hostname

    const result = await api.sources.addXtream({ ...form, name })

    if (!result.success) {
      setStep('error')
      setError(result.error ?? 'Connection failed')
      return
    }

    // Trigger sync
    setStep('syncing')
    setSyncMessage('Starting sync...')

    // Listen for progress
    const unsub = api.on('sync:progress', (progress: any) => {
      setSyncMessage(progress.message)
      if (progress.phase === 'done' || progress.phase === 'error') {
        unsub()
        if (progress.phase === 'done') {
          setStep('done')
          setTimeout(() => { onAdded(); onClose() }, 1200)
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <h2 className="mb-5 text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Add Xtream Source
        </h2>

        <AnimatePresence mode="wait">
          {step === 'form' && (
            <motion.form key="form" onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Field
                label="Name (optional)"
                placeholder="My IPTV Provider"
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
              <div className="grid grid-cols-2 gap-3">
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

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: 'var(--color-card)', color: 'var(--color-text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  Connect
                </button>
              </div>
            </motion.form>
          )}

          {(step === 'testing' || step === 'syncing') && (
            <motion.div key="progress" className="flex flex-col items-center gap-4 py-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Spinner />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {step === 'testing' ? 'Testing connection...' : syncMessage}
              </p>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" className="flex flex-col items-center gap-3 py-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="text-2xl">✓</div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>Sync complete!</p>
            </motion.div>
          )}

          {step === 'error' && (
            <motion.div key="error" className="flex flex-col gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="rounded-lg p-3 text-sm" style={{ background: 'rgba(239,83,80,0.1)', color: 'var(--color-error)' }}>
                {error}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-lg px-4 py-2 text-sm"
                  style={{ background: 'var(--color-card)', color: 'var(--color-text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep('form')}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium"
                  style={{ background: 'var(--color-card-hover)', color: 'var(--color-text-primary)' }}
                >
                  Try Again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function Field({ label, placeholder, value, onChange, type = 'text', required }: {
  label: string; placeholder: string; value: string
  onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-lg px-3 py-2 text-sm outline-none transition-colors"
        style={{
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
      />
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
      style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
    />
  )
}
