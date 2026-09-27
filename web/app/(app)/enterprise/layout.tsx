export default function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: '#0B1829',
      minHeight: '100vh',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    }}>
      {children}
    </div>
  )
}
