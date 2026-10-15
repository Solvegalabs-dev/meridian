'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MeridianBeacon from '@/components/brand/MeridianBeacon'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That invite code isn't valid or has already been used.",
  invalid_display_name: 'Please enter your name.',
  invalid_email: 'Please enter a valid email address.',
  invalid_password: 'Password must be between 8 and 72 characters.',
  account_exists: 'That email already has an account. Sign in instead.',
  create_failed: 'Something went wrong creating your account — please try again.',
  access_pending: 'Your account was created, but access setup did not finish. Please tell Jason so he can finish it.',
}

export default function JoinPage() {
  const router = useRouter()
  const supabase = createClient()

  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountExists, setAccountExists] = useState(false)
  const [loading, setLoading] = useState(false)
  // Honeypot — bots fill hidden fields, humans don't.
  const [honeypot, setHoneypot] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlCode = params.get('code')
    if (urlCode) setCode(urlCode.trim().toUpperCase())
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (honeypot) return // silent bot block
    setError(null)
    setAccountExists(false)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    const res = await fetch('/api/strike/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase(), displayName, email, password, website: honeypot }),
    })

    const data = await res.json() as { success?: boolean; error?: string; message?: string }

    if (!res.ok || !data.success) {
      if (data.error === 'account_exists') setAccountExists(true)
      setError(data.message ?? ERROR_MESSAGES[data.error ?? ''] ?? 'Something went wrong — please try again.')
      setLoading(false)
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      // Account exists server-side — sign-in should not fail here, but if it does,
      // sending the user to login beats a dead end on a page that can't retry signup.
      setError('Account created — please sign in.')
      setLoading(false)
      router.push('/login')
      return
    }

    router.replace('/strike/new')
  }

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 flex flex-col items-center">
          <MeridianBeacon size={56} variant="gold" animate={true} arrowTip={true} />
          <div
            className="mt-3"
            style={{ fontFamily: "'EB Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 28, color: '#fff' }}
          >
            Meridian Strike
          </div>
          <p className="text-[13px] text-white/40 mt-1">Friends and testers</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <h2 className="text-[18px] font-medium text-[var(--text)] mb-5">Join with your invite code</h2>

          {accountExists && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">
              Account exists —{' '}
              <Link href="/login" className="underline font-medium">
                sign in instead
              </Link>
            </div>
          )}

          {error && !accountExists && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{error}</div>
          )}

          {/* Honeypot — hidden from humans, bots fill it */}
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={e => setHoneypot(e.target.value)}
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }}
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1.5">
                Invite code
              </label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().trimStart())}
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="STRIKE-XXXXXX"
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] font-mono tracking-wider focus:outline-none focus:border-[var(--blue)] transition-colors uppercase"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
                maxLength={60}
                autoComplete="name"
                placeholder="Your name"
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--blue)]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !code.trim() || !displayName.trim() || !email.trim() || password.length < 8}
              className="w-full py-2.5 rounded-lg bg-navy text-white text-[14px] font-medium hover:bg-[var(--night)] disabled:opacity-50 transition-colors"
            >
              {loading ? 'Joining...' : 'Join Strike →'}
            </button>
          </form>

          <p className="text-center text-[12px] text-[var(--text3)] mt-5">
            Already have an account?{' '}
            <Link href="/login" className="text-[var(--blue)] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
