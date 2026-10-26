'use client'

import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { heatTier, type SpotEvent } from '@/lib/heat'

export type ScoredEvent = SpotEvent & { score: number; live: boolean }

const HEAT_GRADIENT = { 0.15: '#2f5bea', 0.45: '#ffc23d', 0.75: '#ff7a1f', 1: '#ff4d1f' }

function HeatLayer({ events }: { events: ScoredEvent[] }) {
  const map = useMap()
  const layerRef = useRef<L.HeatLayer | null>(null)

  const points = useMemo(() => {
    const out: [number, number, number][] = []
    for (const e of events) {
      if (e.score <= 0) continue
      const intensity = e.score / 100
      const spread = Math.max(1, Math.round(Math.log10(e.capacity ?? 100)))
      out.push([e.lat, e.lng, intensity])
      for (let i = 0; i < spread * 2; i++) {
        const angle = (i / (spread * 2)) * Math.PI * 2
        const r = 0.0007 * spread
        out.push([e.lat + Math.sin(angle) * r, e.lng + Math.cos(angle) * r * 1.2, intensity * 0.55])
      }
    }
    return out
  }, [events])

  useEffect(() => {
    let cancelled = false
    async function mount() {
      // leaflet.heat registers itself on the global L, so expose it before loading the plugin.
      ;(window as unknown as { L: typeof L }).L = L
      await import('leaflet.heat')
      if (cancelled) return
      layerRef.current = L.heatLayer([], {
        radius: 34,
        blur: 26,
        max: 1,
        minOpacity: 0.25,
        maxZoom: 15,
        gradient: HEAT_GRADIENT,
      }).addTo(map)
      layerRef.current.setLatLngs(pointsRef.current)
    }
    mount()
    return () => {
      cancelled = true
      layerRef.current?.remove()
      layerRef.current = null
    }
  }, [map])

  const pointsRef = useRef(points)
  useEffect(() => {
    pointsRef.current = points
    layerRef.current?.setLatLngs(points)
  }, [points])

  return null
}

function pinIcon(event: ScoredEvent, active: boolean) {
  const tier = heatTier(event.score)
  const label = active ? `<span class="heat-pin-label">${escapeHtml(event.title)}</span>` : ''
  return L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div class="heat-pin" data-tier="${tier}" data-active="${active}" data-live="${event.live}"><span>${event.score}</span>${label}</div>`,
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  const [lat, lng] = center
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true })
  }, [map, lat, lng])
  return null
}

function FocusActive({ event, bottomInset }: { event: ScoredEvent | undefined; bottomInset: number }) {
  const map = useMap()
  const id = event?.id
  useEffect(() => {
    if (!event) return
    map.flyToBounds(L.latLng(event.lat, event.lng).toBounds(500), {
      paddingTopLeft: [24, 120],
      paddingBottomRight: [24, bottomInset + 24],
      maxZoom: 15,
      duration: 0.6,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id])
  return null
}

export function HeatMap({
  center,
  userLocation,
  events,
  activeId,
  onSelect,
  bottomInset,
}: {
  center: [number, number]
  userLocation: [number, number] | null
  events: ScoredEvent[]
  activeId: string | null
  onSelect: (id: string) => void
  bottomInset: number
}) {
  const visible = events.filter((e) => e.score > 0 || e.id === activeId)
  return (
    <MapContainer center={center} zoom={13} className="h-full w-full" zoomControl={false} attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="dark-tiles"
        maxZoom={19}
      />
      <HeatLayer events={events} />
      <Recenter center={center} />
      <FocusActive event={events.find((e) => e.id === activeId)} bottomInset={bottomInset} />
      {userLocation && (
        <CircleMarker
          center={userLocation}
          radius={7}
          pathOptions={{ color: '#eef0f6', weight: 3, fillColor: '#2f5bea', fillOpacity: 1 }}
        />
      )}
      {visible.map((event) => (
        <Marker
          key={event.id}
          position={[event.lat, event.lng]}
          icon={pinIcon(event, event.id === activeId)}
          zIndexOffset={event.id === activeId ? 1000 : event.score}
          title={event.title}
          keyboard
          eventHandlers={{ click: () => onSelect(event.id) }}
        />
      ))}
    </MapContainer>
  )
}
