'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SWEEP_CREDIT_BUNDLES, ASK_CREDIT_BUNDLES } from '@/lib/subscription/tiers'
import { getEffectiveTier } from '@/lib/tiers'
import { registerPushSubscription } from '@/lib/watchlist/registerPush'

interface Profile {
  full_name: string | null
  tone_pref: string | null
  depth_pref: string | null
  tier: string | null
  sweep_count: number | null
  sweep_credits: number | null
  trial_ends_at: string | null
  account_type: string | null
  onboarded_at: string | null
  org_source: string | null
  cohort_data_consent: boolean | null
  created_at: string | null
  phone_number: string | null
  sms_alerts_enabled: boolean | null
}

interface Props {
  email: string
  profile: Profile | null
}

const TIER_LABELS: Record<string, string> = {
  trial: 'Trial',
  explorer: 'Explorer',
  accelerator: 'Accelerator',
  command: 'Command',
}

const TIER_BADGE: Record<string, string> = {
  trial:       'bg-gray-100 text-gray-600',
  explorer:    'bg-blue-100 text-blue-700',
  accelerator: 'bg-amber-100 text-amber-700',
  command:     'bg-purple-100 text-purple-700',
}

const ALPHA_BETA_TYPES = ['alpha_personal', 'alpha_business', 'beta']

export default function SettingsClient({ email, profile }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [tone, setTone] = useState(profile?.tone_pref ?? 'balanced')
  const [depth, setDepth] = useState(profile?.depth_pref ?? 'standard')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<boolean>(profile?.cohort_data_consent ?? true)
  const [consentSaving, setConsentSaving] = useState(false)

  // SMS state
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '')
  const [smsEnabled, setSmsEnabled] = useState(profile?.sms_alerts_enabled ?? false)
  const [smsSaving, setSmsSaving] = useState(false)
  const [smsSaved, setSmsSaved] = useState(false)
  const [smsError, setSmsError] = useState<string | null>(null)

  // Push state
  const [pushStatus, setPushStatus] = useState<'idle' | 'requesting' | 'granted' | 'error'>('idle')
  const [pushError, setPushError] = useState<string | null>(null)

  const effectiveTier = getEffectiveTier({
    tier: profile?.tier ?? null,
    account_type: profile?.account_type ?? null,
  })
  const canUseSms = effectiveTier === 'accelerator' || effectiveTier === 'command'
  const canUsePush = effectiveTier === 'accelerator' || effectiveTier === 'command'

  async function handleConsentToggle() {
    setConsentSaving(true)
    const next = !consent
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cohort_data_consent: next }),
    })
    if (res.ok) {
      setConsent(next)
    }
    setConsentSaving(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, tone_pref: tone, depth_pref: depth }),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.refresh()
    } else {
      const d = await res.json() as { error?: string }
      setError(d.error ?? 'Save failed')
    }
    setSaving(false)
  }

  async function handleSaveSms() {
    setSmsSaving(true)
    setSmsError(null)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneNumber || null, sms_alerts_enabled: smsEnabled }),
    })
    if (res.ok) {
      setSmsSaved(true)
      setTimeout(() => setSmsSaved(false), 2000)
    } else {
      const d = await res.json() as { error?: string }
      setSmsError(d.error ?? 'Save failed')
    }
    setSmsSaving(false)
  }

  async function handlePushEnable() {
    setPushStatus('requesting')
    setPushError(null)
    try {
      await registerPushSubscription()
      setPushStatus('granted')
    } catch (err) {
      setPushStatus('error')
      setPushError(err instanceof Error ? err.message : 'Push registration failed')
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-medium text-[var(--text)]">Settings</h1>
        <p className="text-[13px] text-[var(--text3)] mt-0.5">Profile and intelligence preferences</p>
      </div>

      <div className="space-y-4">
        {/* Account */}
        <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
          <h2 className="text-[13px] font-semibold text-[var(--text)] uppercase tracking-wider mb-4">Account</h2>
          <div className="space-y-3 text-[13px]">
            <div className="flex justify-between py-2 border-b border-[var(--border)]">
              <span className="text-[var(--text3)]">Email</span>
              <span className="text-[var(--text2)]">{email}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-[var(--text3)]">Member since</span>
              <span className="text-[var(--text2)]">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Profile */}
        <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
          <h2 className="text-[13px] font-semibold text-[var(--text)] uppercase tracking-wider mb-4">Profile</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{error}</div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1.5">Full name</label>
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
                placeholder="Your name"
              />
            </div>

            {/* Tone preference */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-2">
                Tone preference — how Meridian Arc speaks to you
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { value: 'direct', label: 'Direct', desc: 'Blunt, no sugar-coating' },
                  { value: 'balanced', label: 'Balanced', desc: 'Clear and professional' },
                  { value: 'encouraging', label: 'Encouraging', desc: 'Supportive and motivating' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTone(opt.value)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      tone === opt.value
                        ? 'border-[var(--blue)] bg-[#E6F1FB]'
                        : 'border-[var(--border)] hover:border-[var(--blue-mid)]'
                    }`}
                  >
                    <p className={`text-[13px] font-medium ${tone === opt.value ? 'text-[var(--blue)]' : 'text-[var(--text)]'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-[var(--text3)] mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Depth preference */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-2">
                Depth preference — how detailed Meridian Arc&apos;s analysis is
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { value: 'brief', label: 'Brief', desc: 'Key points only' },
                  { value: 'standard', label: 'Standard', desc: 'Balanced detail' },
                  { value: 'detailed', label: 'Detailed', desc: 'Full analysis' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setDepth(opt.value)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      depth === opt.value
                        ? 'border-[var(--blue)] bg-[#E6F1FB]'
                        : 'border-[var(--border)] hover:border-[var(--blue-mid)]'
                    }`}
                  >
                    <p className={`text-[13px] font-medium ${depth === opt.value ? 'text-[var(--blue)]' : 'text-[var(--text)]'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-[var(--text3)] mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 rounded-lg bg-navy text-white text-[14px] font-medium hover:bg-[var(--night)] transition-colors disabled:opacity-50"
            >
              {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
          <h2 className="text-[13px] font-semibold text-[var(--text)] uppercase tracking-wider mb-4">Notifications</h2>

          {smsError && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{smsError}</div>
          )}

          <div className="space-y-5">
            {/* SMS */}
            <div>
              <p className="text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-3">SMS Alerts</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] text-[var(--text3)] mb-1.5">Phone number</label>
                  <input
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder="+1XXXXXXXXXX"
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[14px] text-[var(--text)] focus:outline-none focus:border-[var(--blue)] transition-colors"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] text-[var(--text2)]">SMS alerts</p>
                    {!canUseSms && (
                      <p className="text-[11px] text-[var(--text3)] mt-0.5">SMS alerts available on Accelerator and Command plans</p>
                    )}
                  </div>
                  <div
                    onClick={() => canUseSms && setSmsEnabled(v => !v)}
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      smsEnabled && canUseSms ? 'bg-navy' : 'bg-gray-300'
                    } ${canUseSms ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        smsEnabled && canUseSms ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveSms}
                  disabled={smsSaving}
                  className="w-full py-2 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors disabled:opacity-50"
                >
                  {smsSaved ? '✓ Saved' : smsSaving ? 'Saving...' : 'Save SMS settings'}
                </button>
              </div>
            </div>

            {/* Push */}
            <div className="pt-4 border-t border-[var(--border)]">
              <p className="text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-3">Push Notifications</p>

              {pushStatus === 'error' && pushError && (
                <div className="mb-3 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">{pushError}</div>
              )}

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] text-[var(--text2)]">
                    {pushStatus === 'granted' ? 'Push notifications enabled' : 'Enable push notifications'}
                  </p>
                  {!canUsePush && (
                    <p className="text-[11px] text-[var(--text3)] mt-0.5">Available on Accelerator and Command plans</p>
                  )}
                  {canUsePush && pushStatus === 'idle' && (
                    <p className="text-[11px] text-[var(--text3)] mt-0.5">Browser permission prompt will appear</p>
                  )}
                  {pushStatus === 'granted' && (
                    <p className="text-[11px] text-[var(--text3)] mt-0.5">This browser is subscribed to critical alerts</p>
                  )}
                </div>

                {pushStatus !== 'granted' && (
                  <button
                    onClick={handlePushEnable}
                    disabled={!canUsePush || pushStatus === 'requesting'}
                    className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50 ${
                      canUsePush
                        ? 'bg-navy text-white hover:bg-[var(--night)]'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {pushStatus === 'requesting' ? 'Requesting...' : 'Enable'}
                  </button>
                )}
                {pushStatus === 'granted' && (
                  <span className="text-[13px] text-[var(--green)] font-medium">✓ Active</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Plan & Billing */}
        {(() => {
          const tier = profile?.tier ?? 'trial'
          const tierLabel = TIER_LABELS[tier] ?? tier
          const badgeClass = TIER_BADGE[tier] ?? TIER_BADGE.trial
          const isAlphaBeta = ALPHA_BETA_TYPES.includes(profile?.account_type ?? '')
          const sweepCredits = profile?.sweep_credits ?? 0
          const trialEndsAt = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null
          const trialExpired = tier === 'trial' && trialEndsAt && trialEndsAt < new Date()
          const trialActive  = tier === 'trial' && trialEndsAt && trialEndsAt >= new Date()

          return (
            <div id="billing" className="bg-white rounded-2xl border border-[var(--border)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[13px] font-semibold text-[var(--text)] uppercase tracking-wider">Plan &amp; Billing</h2>
                {!isAlphaBeta && (
                  <Link
                    href="/onboarding/plan"
                    className="text-[12px] text-[var(--blue)] hover:underline"
                  >
                    Change plan
                  </Link>
                )}
              </div>

              <div className="space-y-3 text-[13px]">
                {/* Tier badge */}
                <div className="flex items-center justify-between py-2 border-b border-[var(--border)]">
                  <span className="text-[var(--text3)]">Current plan</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${badgeClass}`}>
                    {tierLabel}{isAlphaBeta ? ' · Alpha/Beta' : ''}
                  </span>
                </div>

                {/* Trial end date */}
                {(trialActive || trialExpired) && (
                  <div className="flex items-center justify-between py-2 border-b border-[var(--border)]">
                    <span className="text-[var(--text3)]">Trial {trialExpired ? 'ended' : 'ends'}</span>
                    <span className={`text-[var(--text2)] ${trialExpired ? 'text-red-500' : ''}`}>
                      {trialEndsAt!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {trialExpired && ' — expired'}
                    </span>
                  </div>
                )}

                {/* Sweep credits */}
                <div className="flex items-center justify-between py-2 border-b border-[var(--border)]">
                  <span className="text-[var(--text3)]">Sweep credits</span>
                  <span className="text-[var(--text2)] font-medium">{sweepCredits}</span>
                </div>

                {/* Sweeps run */}
                <div className="flex items-center justify-between py-2">
                  <span className="text-[var(--text3)]">Sweeps run</span>
                  <span className="text-[var(--text2)]">{profile?.sweep_count ?? 0}</span>
                </div>
              </div>

              {/* Credit bundles */}
              <div className="mt-5 pt-4 border-t border-[var(--border)]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text3)] mb-3">Add sweep credits</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {SWEEP_CREDIT_BUNDLES.map(b => (
                    <div
                      key={b.credits}
                      className={`relative rounded-xl border p-3 text-center ${
                        b.best_value ? 'border-amber-300 bg-amber-50' : 'border-[var(--border)] bg-[var(--gray-lt)]'
                      }`}
                    >
                      {b.best_value && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-500 text-[8px] font-bold tracking-widest uppercase text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          Best value
                        </span>
                      )}
                      <p className="text-[16px] font-medium text-[var(--text)]">{b.credits}</p>
                      <p className="text-[10px] text-[var(--text3)] mb-1">sweeps</p>
                      <p className="text-[13px] font-medium text-[var(--text)]">${b.price}</p>
                      <button
                        disabled
                        className="mt-2 w-full py-1 rounded-lg border border-[var(--border)] text-[10px] text-[var(--text3)] cursor-not-allowed opacity-50"
                      >
                        Coming soon
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ask query credit bundles */}
              <div className="mt-5 pt-4 border-t border-[var(--border)]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text3)] mb-3">Add ask query credits</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ASK_CREDIT_BUNDLES.map(b => (
                    <div
                      key={b.credits}
                      className={`relative rounded-xl border p-3 text-center ${
                        b.best_value ? 'border-amber-300 bg-amber-50' : 'border-[var(--border)] bg-[var(--gray-lt)]'
                      }`}
                    >
                      {b.best_value && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-500 text-[8px] font-bold tracking-widest uppercase text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          Best value
                        </span>
                      )}
                      <p className="text-[16px] font-medium text-[var(--text)]">{b.credits}</p>
                      <p className="text-[10px] text-[var(--text3)] mb-1">queries</p>
                      <p className="text-[13px] font-medium text-[var(--text)]">${b.price}</p>
                      <button
                        disabled
                        className="mt-2 w-full py-1 rounded-lg border border-[var(--border)] text-[10px] text-[var(--text3)] cursor-not-allowed opacity-50"
                      >
                        Coming soon
                      </button>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )
        })()}


        {/* Cohort Data Sharing */}
        {profile?.org_source && (
          <div className="bg-white rounded-2xl border border-[var(--border)] p-6">
            <h2 className="text-[13px] font-semibold text-[var(--text)] uppercase tracking-wider mb-3">
              Cohort Data Sharing
            </h2>
            <p className="text-[13px] text-[var(--text3)] mb-4">
              You joined via an organization invite ({profile.org_source}). Aggregated, anonymized
              objective tracking data may be shared with your sponsoring organization and Solvega Labs
              for program insight. Individual data is never sold to third parties.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={handleConsentToggle}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  consent ? 'bg-navy' : 'bg-gray-300'
                } ${consentSaving ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    consent ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </div>
              <span className="text-[13px] text-[var(--text2)]">
                {consent ? 'Sharing enabled' : 'Sharing disabled'}
              </span>
            </label>
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full py-2.5 rounded-lg border border-[var(--red)]/30 text-[var(--red)] text-[13px] hover:bg-[var(--red-lt)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
