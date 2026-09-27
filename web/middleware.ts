import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: always use getUser() — never getSession() — to avoid spoofing
  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Vercel's apex-to-www edge redirect (308) strips the Authorization header
  // before middleware sees the request on www. Detect valid cron tokens here so
  // these routes are never redirected to login — the route handler re-validates.
  const isCronAuth =
    !!process.env.CRON_SECRET &&
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`

  const isPublicPath =
    isCronAuth ||
    pathname === '/' ||
    pathname.startsWith('/home') ||
    pathname.startsWith('/alpha') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/test-sms') ||
    pathname.startsWith('/api/admin/sweeps/process-account-queue') ||
    pathname.startsWith('/api/admin/sweeps/process-scheduled') ||
    pathname.startsWith('/api/enterprise/ingest') ||
    pathname.startsWith('/api/enterprise/sweep') ||
    pathname.startsWith('/api/enterprise/learning/') ||
    pathname.startsWith('/api/enterprise/lite-sweep-cron') ||
    pathname.startsWith('/api/invites/validate') ||
    pathname.startsWith('/api/support/contact') ||
    pathname.startsWith('/api/support/digest') ||
    pathname.startsWith('/api/cron/score-horizons') ||
    pathname.startsWith('/api/cron/agent-swarm') ||
    pathname.startsWith('/api/cron/strike-brief-push') ||
    pathname.startsWith('/api/objectives/create') ||
    pathname.startsWith('/api/mip/') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/faq') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'

  // Unauthenticated → login
  if (!user && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (user) {
    const isEnterpriseOnly = user.app_metadata?.enterprise_only === true

    const isEnterpriseRoute =
      pathname.startsWith('/enterprise') ||
      pathname.startsWith('/api/enterprise') ||
      pathname.startsWith('/onboarding') ||
      pathname.startsWith('/sweep')

    // Enterprise-only users: wall off everything outside /enterprise
    if (isEnterpriseOnly && !isEnterpriseRoute && !isPublicPath) {
      return NextResponse.redirect(new URL('/enterprise', request.url))
    }

    // Non-enterprise users: block access to /enterprise routes
    if (!isEnterpriseOnly && isEnterpriseRoute) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  supabaseResponse.headers.set('x-pathname', pathname)
  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
