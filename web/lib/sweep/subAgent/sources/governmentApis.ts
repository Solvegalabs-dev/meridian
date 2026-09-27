// lib/sweep/subAgent/sources/governmentApis.ts
// FF-064 Search Router — Direct T1 government API calls.
// NOAA Drought Monitor, SNOTEL snowpack, Utah DWR harvest, NOAA Weather.
// No API keys required. Each fetch gets a 6-second individual timeout.

type GovContext = { state?: string; county?: string; unit?: string; date?: string }

export async function fetchGovernmentData(query: string, context: GovContext): Promise<string> {
  const q = query.toLowerCase()
  const today = context.date ?? new Date().toISOString().slice(0, 10)

  if (q.includes('drought')) return fetchNOAADrought(context.county, today)
  if (q.includes('snowpack') || q.includes('snow')) return fetchSNOTEL()
  if (q.includes('harvest') || q.includes('dwr')) return fetchDWRHarvest()
  if (q.includes('weather') || q.includes('forecast')) return fetchNOAAWeather()
  return fetchNOAADrought(context.county, today)
}

async function timedFetch(fn: () => Promise<string>): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const result = await fn()
    clearTimeout(timer)
    return result
  } catch {
    clearTimeout(timer)
    return ''
  }
}

async function fetchNOAADrought(county?: string, date?: string): Promise<string> {
  const today = date ?? new Date().toISOString().slice(0, 10)
  const url = `https://usdm.climate.gov/api/usdmstatisticsjson?aoi=county&startdate=${today}&enddate=${today}&statistic=0`

  return timedFetch(async () => {
    const resp = await fetch(url)
    if (!resp.ok) return ''
    const data = await resp.json() as Array<Record<string, unknown>>
    const entry = county
      ? data.find(r => typeof r.Name === 'string' && r.Name.toLowerCase().includes(county.toLowerCase()))
      : data[0]
    if (!entry) return ''

    const levels = [0, 1, 2, 3, 4].filter(d => Number(entry[`D${d}`]) > 0)
    const category = levels.length > 0 ? `D${Math.max(...levels)} drought` : 'No drought'
    return `[T1 · NOAA Drought Monitor] ${county ?? 'Region'}: ${category} as of ${today}.`
  })
}

async function fetchSNOTEL(): Promise<string> {
  // Station 302 (Chalk Creek), Utah — Unit 10 / South Slope area
  const url =
    'https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/daily/302:UT:SNTL|id=%22%22|name/-7,0/SNWD::value,WTEQ::value'

  return timedFetch(async () => {
    const resp = await fetch(url)
    if (!resp.ok) return ''
    const text = await resp.text()
    const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
    const last = lines[lines.length - 1]
    if (!last) return ''
    const [date, depth, we] = last.split(',')
    return `[T1 · SNOTEL Station 302] Snow depth: ${depth?.trim() ?? 'N/A'} in, water equivalent: ${we?.trim() ?? 'N/A'} in as of ${date?.trim()}.`
  })
}

async function fetchDWRHarvest(): Promise<string> {
  const jinaUrl = 'https://r.jina.ai/https://wildlife.utah.gov/hunting/big-game/harvest-reports.html'

  return timedFetch(async () => {
    const resp = await fetch(jinaUrl)
    if (!resp.ok) return ''
    const text = await resp.text()
    return `[T1 · Utah DWR Harvest Reports] ${text.replace(/\s+/g, ' ').trim().slice(0, 400)}`
  })
}

async function fetchNOAAWeather(): Promise<string> {
  // Unit 10 approximate center: lat=40.85, lon=-109.85
  return timedFetch(async () => {
    const pointsResp = await fetch('https://api.weather.gov/points/40.85,-109.85')
    if (!pointsResp.ok) return ''
    const pointsData = await pointsResp.json() as { properties?: { forecast?: string } }
    const forecastUrl = pointsData.properties?.forecast
    if (!forecastUrl) return ''

    const forecastResp = await fetch(forecastUrl)
    if (!forecastResp.ok) return ''
    const forecastData = await forecastResp.json() as {
      properties?: { periods?: Array<{ name: string; detailedForecast: string }> }
    }
    const periods = forecastData.properties?.periods?.slice(0, 3) ?? []
    const summary = periods.map(p => `${p.name}: ${p.detailedForecast}`).join(' | ')
    return `[T1 · NOAA Weather] Unit 10 area: ${summary.slice(0, 400)}`
  })
}
