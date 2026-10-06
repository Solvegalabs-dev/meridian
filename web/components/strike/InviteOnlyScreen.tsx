import { INVITE_ONLY_MESSAGE } from '@/lib/auth/inviteGate'

export default function InviteOnlyScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-6 text-white">
      <p role="alert" className="max-w-sm text-center text-base text-slate-200">
        {INVITE_ONLY_MESSAGE}
      </p>
    </div>
  )
}
