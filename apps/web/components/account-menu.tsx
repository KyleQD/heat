'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function AccountMenu({ email }: { email: string | null }) {
  const router = useRouter()

  if (!email) {
    return (
      <Link
        href="/auth/login"
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Sign in with Flow
      </Link>
    )
  }

  async function signOut() {
    await createClient().auth.signOut()
    router.refresh()
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden max-w-48 truncate text-muted-foreground sm:inline">{email}</span>
      <button onClick={signOut} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted">
        Sign out
      </button>
    </div>
  )
}
