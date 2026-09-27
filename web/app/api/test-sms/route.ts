import { NextRequest, NextResponse } from 'next/server'
import { sendSmsAlert } from '@/lib/watchlist/sendSmsAlert'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const to = process.env.TEST_PHONE_NUMBER
  if (!to) {
    return NextResponse.json({ error: 'TEST_PHONE_NUMBER env var not set' }, { status: 500 })
  }

  try {
    await sendSmsAlert({
      to,
      objectiveTitle: 'Alaska Airlines First Officer Hire',
      signalSummary: '6 First Officer positions now listed',
      actionText: 'SUBMIT YOUR APPLICATION NOW',
      directUrl: 'https://careers.alaskaair.com/company/alaska-airlines/job-category/pilots/jobs/',
    })
    return NextResponse.json({ success: true, to })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
