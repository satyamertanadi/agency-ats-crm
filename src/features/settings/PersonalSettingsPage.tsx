import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {CalendarCheck,CalendarX,RefreshCw} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {useAuth} from '../../app/AuthProvider'
import {useOrganization} from '../../app/OrganizationProvider'
import {disconnectCalendar,listCalendarConnections,startCalendarConnection} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Page,Panel} from '../../shared/ui/Page'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {formatDateTime} from '../../shared/lib/format'

export function PersonalSettingsPage(){
  const {organization,memberships}=useOrganization();const {user}=useAuth();const [params]=useSearchParams();const cache=useQueryClient();const toast=useToast()
  const currentMember=memberships.find((item)=>item.organization_id===organization?.id&&item.user_id===user?.id)
  const connections=useQuery({queryKey:['calendar-connections',organization?.id],enabled:Boolean(organization),queryFn:()=>listCalendarConnections(organization!.id)})
  const refresh=()=>cache.invalidateQueries({queryKey:['calendar-connections',organization?.id]})
  const connect=useMutation({mutationFn:()=>startCalendarConnection(organization!.id,`/app/${organization!.slug}/admin/personal`),onSuccess:(result)=>window.location.assign(result.authorizationUrl),onError:(error)=>toast.error(error,'Google was not contacted.')})
  const disconnect=useMutation({mutationFn:()=>disconnectCalendar(organization!.id),onSuccess:async()=>{toast.success('Calendar disconnected.','Interviews stay in the ATS but no longer sync.');await refresh()},onError:(error)=>toast.error(error,'The calendar is still connected.')})
  if(connections.isLoading)return <LoadingState/>;if(connections.error)return <ErrorState error={connections.error}/>
  const own=connections.data?.find((item)=>item.member_id===currentMember?.id)
  return <Page title="My settings" eyebrow="Personal preferences" description="Connections and preferences that apply only to your account.">
    {params.get('calendar')==='connected'&&<p className="success-box">Google Calendar connected.</p>}
    <Panel title="Google Calendar" subtitle="Use your own Calendar for interview invitations and updates." elevation="raised"><div className="settings-list">{own?.status==='connected'?<><article><strong>{own.google_email}</strong><p>{own.last_synced_at?`Last synced ${formatDateTime(own.last_synced_at)}`:'Connected and ready'}</p></article>{own.last_error&&<p className="form-error">{own.last_error}</p>}<div className="form-actions"><Button variant="secondary" loading={connect.isPending} leadingIcon={<RefreshCw size={14}/>} onClick={()=>connect.mutate()}>Reconnect</Button><Button variant="caution" loading={disconnect.isPending} leadingIcon={<CalendarX size={14}/>} onClick={()=>disconnect.mutate()}>Disconnect</Button></div></>:<><p className="muted">Connect Google Calendar to create interview events without leaving the job workspace.</p><Button loading={connect.isPending} leadingIcon={<CalendarCheck size={15}/>} onClick={()=>connect.mutate()}>Connect Google Calendar</Button></>}</div>{(connect.error||disconnect.error)&&<p className="form-error" role="alert">{(connect.error||disconnect.error)?.message}</p>}</Panel>
  </Page>
}
