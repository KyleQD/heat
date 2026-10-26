'use client'

import dynamic from 'next/dynamic'
import { Flame } from 'lucide-react'

// Everything is relative to the viewer's clock and timezone, so render on the client only.
const HeatExplorer = dynamic(() => import('@/components/heat-explorer').then((m) => m.HeatExplorer), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-background">
      <Flame className="size-8 animate-pulse text-primary" aria-label="Loading HEAT" />
    </div>
  ),
})

export function HeatApp(props: { userId: string | null; userEmail: string | null }) {
  return <HeatExplorer {...props} />
}
