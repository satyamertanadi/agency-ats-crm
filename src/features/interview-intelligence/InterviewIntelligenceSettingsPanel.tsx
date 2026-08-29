import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Plus,Trash2} from 'lucide-react'
import {Panel} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Field,Input,Select} from '../../shared/ui/Field'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {listTeamMembers} from '../core/commercialRepository'
import {
  addDigestRecipient,getInterviewSettings,listDigestRecipientIds,removeDigestRecipient,
  updateInterviewSettings,type SettingsPatch,
} from './adminRepository'
import {InterviewCoreRubricPanel} from './InterviewCoreRubricPanel'

/* Everything needed to switch Interview Intelligence on, in the workspace settings.
 *
 * These four switches previously existed only as database columns, which meant the feature could be
 * deployed and still be unreachable -- and the person who could fix that was whoever had a database
 * connection, not whoever owned the desk.
 *
 * The switches are not presented as equals. Enabling the feature and letting it draft blueprints are
 * ordinary product choices. Collecting Meet transcripts and analysing every interview automatically
 * change what happens to colleagues' work without anybody pressing a button that day, so they carry
 * what they actually do rather than a restatement of their own names.
 */

interface ToggleRowProps {
  label:string
  description:string
  checked:boolean
  disabled?:boolean
  pending?:boolean
  onChange:(value:boolean)=>void
  caution?:boolean
}

function ToggleRow({label,description,checked,disabled,pending,onChange,caution}:ToggleRowProps){
  return <article className="interview-toggle">
    <label>
      <input type="checkbox" checked={checked} disabled={disabled||pending}
        onChange={(event)=>onChange(event.target.checked)}/>
      <span>
        <strong>{label}</strong>
        <small className={caution?'interview-toggle-caution':undefined}>{description}</small>
      </span>
    </label>
  </article>
}

export function InterviewIntelligenceSettingsPanel({organizationId}:{organizationId:string}){
  const toast=useToast()
  const cache=useQueryClient()
  const [recipientToAdd,setRecipientToAdd]=useState('')

  const settings=useQuery({
    queryKey:['interview-settings',organizationId],
    queryFn:()=>getInterviewSettings(organizationId),
  })
  const recipients=useQuery({
    queryKey:['interview-digest-recipients',organizationId],
    queryFn:()=>listDigestRecipientIds(organizationId),
  })
  const team=useQuery({
    queryKey:['team',organizationId],
    queryFn:()=>listTeamMembers(organizationId),
  })

  const refreshSettings=()=>cache.invalidateQueries({queryKey:['interview-settings',organizationId]})
  const refreshRecipients=()=>cache.invalidateQueries({queryKey:['interview-digest-recipients',organizationId]})

  const save=useMutation({
    mutationFn:(patch:SettingsPatch)=>updateInterviewSettings(organizationId,patch),
    onSuccess:async()=>{await refreshSettings();toast.success('Settings saved.')},
    onError:(error)=>{void refreshSettings();toast.error(error,'Nothing was changed.')},
  })
  const addRecipient=useMutation({
    mutationFn:(memberId:string)=>addDigestRecipient(organizationId,memberId),
    onSuccess:async()=>{setRecipientToAdd('');await refreshRecipients();toast.success('Added to the daily brief.')},
    onError:(error)=>toast.error(error,'That person was not added.'),
  })
  const removeRecipient=useMutation({
    mutationFn:(memberId:string)=>removeDigestRecipient(organizationId,memberId),
    onSuccess:async()=>{await refreshRecipients();toast.success('Removed from the daily brief.')},
    onError:(error)=>toast.error(error,'That person is still on the list.'),
  })

  if(settings.isLoading)return <Panel title="Interview Intelligence"><TableSkeleton rows={4} columns={2} label="Loading settings…"/></Panel>
  if(settings.error)return <ErrorState error={settings.error}/>
  const current=settings.data
  if(!current)return <Panel title="Interview Intelligence"><EmptyState title="No settings found" description="This workspace has no settings row."/></Panel>

  const members=team.data||[]
  const recipientIds=recipients.data||[]
  const memberName=(memberId:string)=>members.find((member)=>member.id===memberId)?.profiles?.full_name||'Team member'
  const available=members.filter((member)=>member.status==='active'&&!recipientIds.includes(member.id))

  return <>
    <Panel title="Interview Intelligence"
      subtitle="Reads interview transcripts to produce evidence-backed notes on the candidate and coaching for the consultant.">
      <div className="settings-list">
        <ToggleRow label="Enable Interview Intelligence"
          description="Consultants can record consent, import transcripts and request an analysis. Nothing is analysed until someone asks."
          checked={current.intelligenceEnabled} pending={save.isPending}
          onChange={(value)=>save.mutate({intelligenceEnabled:value})}/>

        <ToggleRow label="Draft interview blueprints from the job brief"
          description="Lets a consultant generate a first draft of a job's blueprint. The draft is always edited and activated by a person."
          checked={current.rubricGenerationEnabled} pending={save.isPending}
          disabled={!current.intelligenceEnabled}
          onChange={(value)=>save.mutate({rubricGenerationEnabled:value})}/>

        <ToggleRow label="Collect Google Meet transcripts automatically"
          description="Finished Meet interviews have their transcript imported without anyone pasting it. Each consultant must also grant transcript access on their own Google connection."
          checked={current.meetAutoImportEnabled} pending={save.isPending}
          disabled={!current.intelligenceEnabled}
          onChange={(value)=>save.mutate({meetAutoImportEnabled:value})}/>

        <ToggleRow label="Analyse every interview automatically" caution
          description="Runs a paid analysis on every transcript as soon as its speakers are confirmed, without anyone asking. Leave this off until the rubric's judgement has been checked against real interviews from this desk."
          checked={current.autoAnalysisEnabled} pending={save.isPending}
          disabled={!current.intelligenceEnabled}
          onChange={(value)=>save.mutate({autoAnalysisEnabled:value})}/>
      </div>

      {!current.intelligenceEnabled&&<Callout tone="info" title="Currently off for this workspace">
        Consultants will not see transcript or analysis controls on an interview until this is enabled.
      </Callout>}

      {current.intelligenceEnabled&&!current.coreRubricId&&
        <Callout tone="warning" title="No agency core rubric is active">
          Every analysis reads the agency core rubric as well as the job's own blueprint, so interviews
          cannot be analysed until one is active. Create it below.
        </Callout>}
    </Panel>

    <InterviewCoreRubricPanel organizationId={organizationId}
      activeRubricId={current.coreRubricId} draftRubricId={current.coreRubricDraftId}
      onChanged={refreshSettings}/>

    <Panel title="Daily interview brief"
      subtitle={`One email a day summarising what needs attention. Sent at the time below in ${current.timezone}.`}>
      <div className="settings-list">
        <ToggleRow label="Send the daily brief"
          description="Counts only — the email never contains transcript text, candidate details or written assessments."
          checked={current.digestEnabled} pending={save.isPending}
          disabled={!current.intelligenceEnabled}
          onChange={(value)=>save.mutate({digestEnabled:value})}/>

        <ToggleRow label="Skip days with nothing to report"
          description="A brief with no interviews and no outstanding coaching is not sent. Turning this off sends it every day regardless."
          checked={current.digestSkipEmpty} pending={save.isPending}
          disabled={!current.intelligenceEnabled}
          onChange={(value)=>save.mutate({digestSkipEmpty:value})}/>
      </div>

      <Field label={`Send at (${current.timezone})`}>
        <div className="color-field">
          <Input type="time" value={current.digestLocalTime} disabled={save.isPending}
            onChange={(event)=>{
              const value=event.target.value
              // A cleared time input reports "", which would blank a required column.
              if(value)save.mutate({digestLocalTime:value})
            }}/>
        </div>
      </Field>

      <h4 className="settings-subhead">Who receives it</h4>
      {recipientIds.length===0
        ? <p className="muted">Nobody yet. The brief is not sent until at least one person is named.</p>
        : <div className="list">
            {recipientIds.map((memberId)=><article className="list-row" key={memberId}>
              <div><strong>{memberName(memberId)}</strong></div>
              <Button variant="caution" leadingIcon={<Trash2 size={14}/>}
                loading={removeRecipient.isPending} onClick={()=>removeRecipient.mutate(memberId)}>Remove</Button>
            </article>)}
          </div>}

      <div className="color-field">
        <Select aria-label="Add a recipient" value={recipientToAdd} disabled={available.length===0}
          onChange={(event)=>setRecipientToAdd(event.target.value)}>
          <option value="">{available.length===0?'Everyone active is already on the list':'Choose a team member…'}</option>
          {available.map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||'Team member'}</option>)}
        </Select>
        <Button variant="secondary" leadingIcon={<Plus size={14}/>} disabled={!recipientToAdd}
          loading={addRecipient.isPending} onClick={()=>addRecipient.mutate(recipientToAdd)}>Add</Button>
      </div>
      <p className="muted">
        Recipients are named individually rather than derived from a role, so nobody starts receiving a
        summary of their colleagues' interviews because their permissions changed.
      </p>
    </Panel>
  </>
}
