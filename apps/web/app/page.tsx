import { HeatExplorer } from '@/components/heat-explorer'
import { createClient } from '@/lib/supabase/server'

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return <HeatExplorer userId={user?.id ?? null} userEmail={user?.email ?? null} />
}
