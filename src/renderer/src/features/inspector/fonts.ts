import { useEffect, useState } from 'react'

const FALLBACK = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Impact',
  'Comic Sans MS'
]
let cached: string[] | null = null

interface LocalFontsWindow {
  queryLocalFonts?: () => Promise<Array<{ family: string }>>
}

/** Installed font families (Local Font Access API), with a safe fallback list. */
export function useFontFamilies(): string[] {
  const [fonts, setFonts] = useState(cached ?? FALLBACK)
  useEffect(() => {
    if (cached) return
    void (window as unknown as LocalFontsWindow)
      .queryLocalFonts?.()
      .then((list) => {
        cached = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
        if (cached.length > 0) setFonts(cached)
      })
      .catch(() => {})
  }, [])
  return fonts
}
