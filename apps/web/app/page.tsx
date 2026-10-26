import { HeatApp } from '@/components/heat-app'
import { createClient } from '@/lib/supabase/server'

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return <HeatApp userId={user?.id ?? null} userEmail={user?.email ?? null} />
}
