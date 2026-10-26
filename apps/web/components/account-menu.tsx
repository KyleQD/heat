'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogOut, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function AccountMenu({ email, compact = false }: { email: string | null; compact?: boolean }) {
  const router = useRouter()

  if (!email) {
    return (
      <Link
        href="/auth/login"
        className={
          compact
            ? 'glass flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-foreground'
            : 'flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground'
        }
      >
        {compact && <UserRound className="size-4" aria-hidden />}
        Sign in with Flow
      </Link>
    )
  }

  async function signOut() {
    await createClient().auth.signOut()
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {!compact && <span className="max-w-40 truncate text-muted-foreground">{email}</span>}
      <button
        type="button"
        onClick={signOut}
        aria-label="Sign out"
        className={
          compact
            ? 'glass flex size-11 items-center justify-center rounded-full text-foreground'
            : 'flex size-10 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted'
        }
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  )
}
