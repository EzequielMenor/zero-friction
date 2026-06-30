import { redirect } from 'next/navigation'
import HubContent from './HubContent'
import { SUPPORTED_SLUGS } from '@/lib/hubs'

// Server component — validates params and renders client content
export default async function HubPage({
  params,
}: {
  params: Promise<{ domain: string }>
}) {
  const { domain } = await params

  if (!(SUPPORTED_SLUGS as readonly string[]).includes(domain)) {
    redirect('/')
  }

  return <HubContent slug={domain} />
}
