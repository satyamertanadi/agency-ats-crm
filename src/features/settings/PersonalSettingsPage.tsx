import {useQuery} from '@tanstack/react-query'
import {useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {listCalendarConnections} from '../core/commercialRepository'
import {Page} from '../../shared/ui/Page'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {CalendarConnectionCard} from './CalendarConnectionCard'

export function PersonalSettingsPage(){
  const {organization,membership}=useOrganization();const [params]=useSearchParams()
  const currentMember=membership
  const connections=useQuery({queryKey:['calendar-connections',organization?.id],enabled:Boolean(organization),queryFn:()=>listCalendarConnections(organization!.id)})
  if(connections.isLoading)return <LoadingState/>;if(connections.error)return <ErrorState error={connections.error}/>
  const own=connections.data?.find((item)=>item.member_id===currentMember?.id)
  return <Page title="My settings" eyebrow="Personal preferences" description="Connections and preferences that apply only to your account.">
    {/* The card, its two mutations and its three states used to be written out here and again in
      * SettingsPage. Only the return path differs, and it has to: Google sends the browser back, and
      * back should mean the page you left. */}
    <CalendarConnectionCard connection={own} elevation="raised" justConnected={params.get('calendar')==='connected'}
      returnPath={`/app/${organization?.slug}/admin/personal`}/>
  </Page>
}
