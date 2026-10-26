'use client'

import { Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock } from '@/lib/heat'

export const STEP_MINUTES = 30
export const STEPS = 24

export function TimeScrubber({
  now,
  step,
  onStepChange,
  totals,
}: {
  now: number
  step: number
  onStepChange: (step: number) => void
  /** Overall area heat at each step, used to draw the forecast bars. */
  totals: number[]
}) {
  const [playing, setPlaying] = useState(false)
  const max = Math.max(1, ...totals)
  const t = now + step * STEP_MINUTES * 60_000

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      onStepChange(step >= STEPS ? 0 : step + 1)
    }, 600)
    return () => clearInterval(id)
  }, [playing, step, onStepChange])

  const peakStep = totals.indexOf(max)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {step === 0 ? (
            <>
              <span className="font-semibold text-foreground">Right now</span> · {formatClock(t)}
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">{formatClock(t)}</span> · in{' '}
              {step * STEP_MINUTES >= 60
                ? `${(step * STEP_MINUTES) / 60}h`
                : `${step * STEP_MINUTES}m`}
            </>
          )}
        </p>
        {peakStep > 0 && (
          <button
            type="button"
            onClick={() => onStepChange(peakStep)}
            className="text-xs font-medium text-accent underline-offset-4 hover:underline"
          >
            Peaks {formatClock(now + peakStep * STEP_MINUTES * 60_000)}
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause heat forecast' : 'Play heat forecast'}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
        </button>

        <div className="relative h-11 flex-1">
          <div aria-hidden className="absolute inset-x-0 bottom-3 top-0 flex items-end gap-px">
            {totals.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm transition-colors"
                style={{
                  height: `${Math.max(8, (v / max) * 100)}%`,
                  background: i === step ? 'var(--primary)' : i < step ? 'var(--heat-dim)' : 'var(--muted)',
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={STEPS}
            step={1}
            value={step}
            onChange={(e) => {
              setPlaying(false)
              onStepChange(Number(e.target.value))
            }}
            aria-label="Forecast time"
            aria-valuetext={step === 0 ? 'Now' : formatClock(t)}
            className="scrubber absolute inset-0 h-full w-full"
          />
        </div>
      </div>
    </div>
  )
}
