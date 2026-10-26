'use client'

import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { heatColor, isLive, type HeatEvent } from '@/lib/events'

function pinIcon(event: HeatEvent, active: boolean) {
  const size = Math.round(22 + (event.heat_score / 100) * 18)
  const muted = event.status !== 'scheduled'
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="heat-pin" data-active="${active}" style="width:${size}px;height:${size}px;background:${heatColor(
      event.heat_score,
    )};opacity:${muted ? 0.45 : 1}">${isLive(event) ? '●' : event.heat_score}</div>`,
  })
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [map, center[0], center[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function FlyToActive({ event }: { event: HeatEvent | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (event) map.flyTo([event.lat, event.lng], Math.max(map.getZoom(), 14), { duration: 0.6 })
  }, [map, event])
  return null
}

export function EventMap({
  center,
  events,
  activeId,
  onSelect,
}: {
  center: [number, number]
  events: HeatEvent[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <Recenter center={center} />
      <FlyToActive event={events.find((e) => e.id === activeId)} />
      {events.map((event) => (
        <Marker
          key={event.id}
          position={[event.lat, event.lng]}
          icon={pinIcon(event, event.id === activeId)}
          zIndexOffset={event.id === activeId ? 1000 : event.heat_score}
          title={event.title}
          eventHandlers={{ click: () => onSelect(event.id) }}
        />
      ))}
    </MapContainer>
  )
}
