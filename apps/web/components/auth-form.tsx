'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function friendlyError(message: string, mode: 'login' | 'sign-up') {
  const m = message.toLowerCase()
  if (m.includes('not confirmed')) return 'Please confirm your email before signing in.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait and try again.'
  if (m.includes('password') && mode === 'sign-up') return message
  if (mode === 'login') return 'Invalid email or password.'
  return 'Something went wrong. Please try again.'
}

export function AuthForm({ mode }: { mode: 'login' | 'sign-up' }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const supabase = createClient()
    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo:
                process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
            },
          })
    setPending(false)
    if (error) return setError(friendlyError(error.message, mode))
    router.push(mode === 'login' ? '/' : '/auth/sign-up-success')
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <Link href="/" className="font-display text-2xl font-bold text-primary">
            HEAT
          </Link>
          <h1 className="font-display text-xl font-semibold">
            {mode === 'login' ? 'Sign in with your Flow account' : 'Create your Flow account'}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            One account across Flow and its satellite apps.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 font-normal outline-none focus:border-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 font-normal outline-none focus:border-ring"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="text-center text-sm text-muted-foreground">
          {mode === 'login' ? (
            <>
              New to Flow?{' '}
              <Link href="/auth/sign-up" className="font-medium text-foreground underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have one?{' '}
              <Link href="/auth/login" className="font-medium text-foreground underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  )
}
