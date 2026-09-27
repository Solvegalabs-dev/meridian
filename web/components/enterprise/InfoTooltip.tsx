'use client'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

export function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const iconRef = useRef<SVGSVGElement>(null)

  function handleMouseEnter() {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      setCoords({
        top: rect.top + window.scrollY - 8,
        left: rect.left + window.scrollX + rect.width / 2,
      })
    }
    setVisible(true)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 4 }}>
      <svg
        ref={iconRef}
        width="13"
        height="13"
        viewBox="0 0 13 13"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setVisible(false)}
        style={{ cursor: 'pointer', display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      >
        <circle cx="6.5" cy="6.5" r="6" stroke="#5090C0" strokeWidth="1"/>
        <rect x="6" y="5.5" width="1" height="4" rx="0.5" fill="#5090C0"/>
        <rect x="6" y="3.5" width="1" height="1" rx="0.5" fill="#5090C0"/>
      </svg>
      {visible && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'absolute',
          top: coords.top,
          left: coords.left,
          transform: 'translate(-50%, -100%)',
          backgroundColor: '#0D1B3E',
          color: '#ffffff',
          border: '1px solid rgba(46,124,184,0.4)',
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 12,
          width: 220,
          zIndex: 9999,
          lineHeight: 1.5,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          whiteSpace: 'normal',
          fontFamily: "'Inter', sans-serif",
        }}>
          {text}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #0D1B3E',
          }} />
        </div>,
        document.body
      )}
    </span>
  )
}
