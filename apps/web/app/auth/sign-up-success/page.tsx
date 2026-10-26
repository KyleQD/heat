import Link from 'next/link'

export default function SignUpSuccessPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col gap-2 rounded-lg border border-border bg-card p-6">
        <h1 className="font-display text-xl font-semibold">Check your email</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Confirm your address to finish creating your Flow account, then come back to HEAT.
        </p>
        <Link href="/" className="text-sm font-medium underline">
          Back to the map
        </Link>
      </div>
    </main>
  )
}
