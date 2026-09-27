'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface InstitutionOption {
  id: string
  name: string
}

interface Props {
  institutions: InstitutionOption[]
}

export function InstitutionSwitcher({ institutions }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentIid = searchParams.get('iid')

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('iid', e.target.value)
    router.push(`${pathname}?${params.toString()}`)
  }

  const selectedId = currentIid ?? institutions[0]?.id

  if (institutions.length < 2) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 whitespace-nowrap">Institution</span>
      <select
        value={selectedId}
        onChange={handleChange}
        className="text-sm bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {institutions.map(inst => (
          <option key={inst.id} value={inst.id}>
            {inst.name}
          </option>
        ))}
      </select>
    </div>
  )
}
