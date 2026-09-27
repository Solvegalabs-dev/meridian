'use client'

type MapPin = { type: string; lat: number; lon: number; confidence: string; label: string }
type Props = { pins?: MapPin[]; isOnline: boolean }

export default function StrikeMapStrip({ pins, isOnline }: Props) {
  if (!isOnline || !pins || pins.length === 0) return null

  return (
    <div className="h-24 bg-slate-800 rounded-lg flex items-center justify-center mb-4 text-slate-500 text-sm">
      Map — {pins.length} terrain {pins.length === 1 ? 'pin' : 'pins'}
    </div>
  )
}
