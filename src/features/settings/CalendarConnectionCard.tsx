import {useMutation,useQueryClient} from '@tanstack/react-query'
import {CalendarCheck,CalendarX,FileText,RefreshCw} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {disconnectCalendar,startCalendarConnection} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Panel} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {formatDateTime} from '../../shared/lib/format'
import type {CalendarConnection} from '../../shared/types/domain'

/* Named once, compared against the granted list. The Meet fetcher's discovery query filters on this
 * same string in SQL, and a card that checked a different spelling would report access the worker
 * cannot use. */
const MEET_SCOPE='https://www.googleapis.com/auth/meetings.space.readonly'

/* One Google Calendar card, for the two pages that each had their own.
 *
 * They were the same panel written twice with the same two mutations and the same three states, and
 * they had already drifted: the workspace copy explained what connecting actually does ("ATS interview
 * changes create and update events on your primary Calendar"), the personal copy did not, and only one
 * of them acknowledged the `?calendar=connected` return from the OAuth round-trip. Each page keeps its
 * own `returnPath` -- coming back from Google to the page you left is the whole point -- and nothing
 * else differs.
 *
 * `last_error` was previously rendered as bare `.form-error` text with no role, so a sync failure was
 * visible but never announced. It is a Callout with a way out: the reconnect button sits under it,
 * because an expired token is a thing to fix, not a thing to read.
 */
export function CalendarConnectionCard({connection,returnPath,justConnected=false,title='Google Calendar',subtitle='Use your own Calendar for interview invitations and updates.',elevation}:{
  connection?:CalendarConnection|null
  /* Where Google sends the browser back to. Absolute app path, not a full URL. */
  returnPath:string
  justConnected?:boolean
  title?:string
  subtitle?:string
  elevation?:'raised'
}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const refresh=()=>cache.invalidateQueries({queryKey:['calendar-connections',organization?.id]})
  /* Navigating away to Google is the success path, so there is no success toast here -- the page is
   * gone before it could be read. A failure to even reach Google is the only thing worth saying. */
  /* Explicit variables type: with only a defaulted parameter TanStack infers `void` and every caller
   * that passes the Meet flag stops compiling. */
  const connect=useMutation<{authorizationUrl:string},Error,boolean>({mutationFn:(withMeet)=>startCalendarConnection(organization!.id,returnPath,withMeet),onSuccess:(result)=>window.location.assign(result.authorizationUrl),onError:(error)=>toast.error(error,'Google was not contacted.')})
  const disconnect=useMutation({mutationFn:()=>disconnectCalendar(organization!.id),onSuccess:async()=>{toast.success('Calendar disconnected.','Interviews stay in the ATS but no longer sync.');await refresh()},onError:(error)=>toast.error(error,'The calendar is still connected.')})
  const connected=connection?.status==='connected'
  /* Meet transcript access is a separate grant, so it gets a separate line rather than being folded
   * into "connected". Read from what Google returned, never from what we requested: incremental
   * consent lets somebody approve the calendar and decline the transcript box, and a card that
   * reported the request would tell a consultant transcripts are arriving when none can. */
  const meetGranted=Boolean(connection?.scopes?.includes(MEET_SCOPE))
  return <>
    {justConnected&&<Callout tone="success">Google Calendar connected.</Callout>}
    {/* An expired grant is not the same as never having connected, and the difference matters: nothing
      * is syncing and no transcript can be fetched until somebody acts. Saying "Connect" here would
      * read as an optional extra rather than a broken integration. */}
    {connection?.status==='reauthorization_required'&&<Callout tone="warning" title="Reauthorisation required">Google no longer accepts the saved authorisation for {connection.google_email}. Interview syncing and transcript collection are paused until you reconnect.</Callout>}
    <Panel title={title} subtitle={subtitle} elevation={elevation}>
    <div className="settings-list">
      {connected?<>
        <article><strong>{connection.google_email}</strong><p>{connection.last_synced_at?`Connected · last synced ${formatDateTime(connection.last_synced_at)}`:'Connected · not synced yet'}</p></article>
        {connection.last_error&&<Callout tone="warning" title="Last sync failed">{connection.last_error}</Callout>}
        <article>
          <strong>Meet transcript access</strong>
          {meetGranted
            ?<p>Granted · transcripts from your Meet interviews can be collected automatically.</p>
            :<p className="muted">Not granted. Transcripts can still be pasted in by hand on each interview.</p>}
        </article>
        <div className="form-actions">
          {!meetGranted&&<Button variant="secondary" loading={connect.isPending} leadingIcon={<FileText size={14}/>} onClick={()=>connect.mutate(true)}>Allow transcript access</Button>}
          <Button variant="secondary" loading={connect.isPending} leadingIcon={<RefreshCw size={14}/>} onClick={()=>connect.mutate(meetGranted)}>Reconnect</Button>
          <Button variant="caution" loading={disconnect.isPending} leadingIcon={<CalendarX size={14}/>} onClick={()=>disconnect.mutate()}>Disconnect</Button>
        </div>
      </>:<>
        <p className="muted">Connect your Google account so interview changes made here create and update events on your primary Calendar. Interviews are always saved in the ATS either way.</p>
        <Button loading={connect.isPending} leadingIcon={<CalendarCheck size={15}/>} onClick={()=>connect.mutate(false)}>Connect Google Calendar</Button>
      </>}
    </div>
    {(connect.error||disconnect.error)&&<p className="form-error" role="alert">{(connect.error||disconnect.error)?.message}</p>}
  </Panel>
  </>
}
