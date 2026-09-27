import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Meridian Strike' }

export default function StrikeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
