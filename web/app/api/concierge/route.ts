export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/api/ask', request.url), 308)
}

export async function POST(req: NextRequest) {
  return NextResponse.redirect(new URL('/api/ask', req.url), 308)
}
