import {useEffect,useMemo,useRef,useState} from 'react'
import {useMutation,useQuery} from '@tanstack/react-query'
import {FileText} from 'lucide-react'
import {Link} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {listContacts} from '../core/repository'
import {listSubmissionCandidateDocuments,sendClientSubmission} from '../core/commercialRepository'
import type {Job} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {CollapsibleSection} from '../../shared/ui/CollapsibleSection'
import {Drawer} from '../../shared/ui/Drawer'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {candidateAvailability} from '../../shared/lib/optionSets'
import {Badge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'

/* The only client-submission path. It sends one candidate or a shortlist through the same package,
 * email and review-link flow, with the essential pitch visible and supporting details optional. */

export interface ComposerCandidate {jobCandidateId:string;name:string}

/* Three inputs per candidate, not ten. On a three-person shortlist the old set put thirty fields
 * between the consultant and a client email, four of which (why they fit, relevant experience,
 * motivation, relocation) were free-text boxes restating what the CV and the summary already say.
 *
 * Salary, notice and availability are not gone -- they are still sent. They are facts already on the
 * candidate record, so the composer shows them read-only and links to the record to change them,
 * rather than offering an editable copy that can silently disagree with the source. */
interface ItemDraft {
  candidate_summary:string;recruiter_comments:string
  expected_salary:string;currency:string;notice_period:string;availability:string
  document_ids:string[]
}
const emptyDraft=():ItemDraft=>({candidate_summary:'',recruiter_comments:'',
  expected_salary:'',currency:'',notice_period:'',availability:'',document_ids:[]})

const factSalary=(draft?:ItemDraft)=>{
  const amount=draft?.expected_salary?.trim()
  if(!amount)return 'Not recorded'
  return [amount,draft?.currency?.trim()].filter(Boolean).join(' ')
}

type SubmissionPrivate={consent_status:string;expected_salary:number|null;salary_currency:string|null}
const privateOf=(candidate?:{candidate_private_details?:SubmissionPrivate|SubmissionPrivate[]|null}|null)=>{
  const value=candidate?.candidate_private_details
  return Array.isArray(value)?value[0]:value
}

export function SubmissionComposerDrawer({open,onClose,job,organizationId,candidates,onSent}:{
  open:boolean
  onClose:()=>void
  job:Job
  organizationId:string
  /* Who the caller wants in the package. The composer still resolves each one's documents and consent
   * itself, so the board can pass nothing richer than ids and names. */
  candidates:ComposerCandidate[]
  onSent:()=>Promise<unknown>
}){
  const toast=useToast();const {organization}=useOrganization()
  const candidateBase=`/app/${organization?.slug||'workspace'}/candidates`
  const [drafts,setDrafts]=useState<Record<string,ItemDraft>>({})
  const [title,setTitle]=useState('')
  const [message,setMessage]=useState('Please review these candidates for the role.')
  const [recipientName,setRecipientName]=useState('');const [recipientEmail,setRecipientEmail]=useState('')
  const [expiryDays,setExpiryDays]=useState(7)
  const [edited,setEdited]=useState(false)
  const requestKey=useRef('');const requestFingerprint=useRef('')

  const rows=useQuery({queryKey:['submission-candidates',organizationId,job.id],enabled:open,queryFn:()=>listSubmissionCandidateDocuments(organizationId,job.id)})
  const contacts=useQuery({queryKey:['contacts',organizationId],enabled:open,queryFn:()=>listContacts(organizationId)})
  const clientContacts=(contacts.data||[]).filter((contact)=>contact.company_id===job.company_id&&contact.contact_status!=='do_not_contact')

  /* Default title states what the client is receiving before they open it -- "3 candidates · Head of
   * Brand" is a subject line; "Submission" is not. */
  useEffect(()=>{
    if(!open)return
    setTitle(`${candidates.length} candidate${candidates.length===1?'':'s'} · ${job.title}`)
    setDrafts(Object.fromEntries(candidates.map((candidate)=>[candidate.jobCandidateId,emptyDraft()])))
    setMessage(`Please review ${candidates.length===1?'this candidate':'these candidates'} for the role.`)
    setRecipientName('');setRecipientEmail('');setExpiryDays(7);setEdited(false)
    requestKey.current='';requestFingerprint.current=''
  },[open,candidates,job.title])

  /* Salary, notice and availability already exist on the candidate. Re-typing them at submission is
   * slower and creates a second, contradictory copy before the package is even sent. */
  useEffect(()=>{
    if(!open||!rows.isSuccess)return
    setDrafts((current)=>Object.fromEntries(candidates.map((candidate)=>{
      const row=rows.data.find((entry)=>entry.id===candidate.jobCandidateId)
      const record=row?.candidates;const privateData=privateOf(record)
      const seeded:ItemDraft={...emptyDraft(),
        candidate_summary:`${candidate.name} — ${record?.current_position||'Experienced candidate'}${record?.current_company?` at ${record.current_company}`:''}.`,
        expected_salary:privateData?.expected_salary!=null?String(privateData.expected_salary):'',
        currency:privateData?.salary_currency||job.currency||'',
        notice_period:record?.notice_period_days!=null?`${record.notice_period_days} days`:'',
        availability:record?.availability||'',
      }
      const existing=current[candidate.jobCandidateId]
      return [candidate.jobCandidateId,existing?{...seeded,...existing,
        candidate_summary:existing.candidate_summary||seeded.candidate_summary,
        expected_salary:existing.expected_salary||seeded.expected_salary,
        currency:existing.currency||seeded.currency,
        notice_period:existing.notice_period||seeded.notice_period,
        availability:existing.availability||seeded.availability}:seeded]
    })))
  },[candidates,job.currency,open,rows.data,rows.isSuccess])

  const resolved=useMemo(()=>candidates.map((candidate)=>{
    const row=(rows.data||[]).find((entry)=>entry.id===candidate.jobCandidateId)
    const documents=(row?.candidates?.document_links||[]).flatMap((link)=>Array.isArray(link.documents)?link.documents:link.documents?[link.documents]:[])
      .filter((document)=>document&&!document.deleted_at)
    const consent=privateOf(row?.candidates)?.consent_status
    return {...candidate,row,documents,consent,
      /* The same compliance bar applies per row: consent granted and not
       * marked do-not-contact. Blocking the send rather than filtering silently, because a shortlist
       * that quietly drops someone is worse than one that refuses and says who.
       *
       * Only once the roster query has actually answered. Judging consent from a row that has not
       * loaded reads every candidate as un-consented, so the drawer opened claiming the entire
       * shortlist was blocked and then quietly corrected itself. */
      blocked:rows.isSuccess&&(row?.candidates?.status==='do_not_contact'||consent!=='granted')}
  }),[candidates,rows.data,rows.isSuccess])
  const blocked=resolved.filter((entry)=>entry.blocked)
  const sendable=resolved.filter((entry)=>!entry.blocked)

  const update=(id:string,patch:Partial<ItemDraft>)=>{setEdited(true);setDrafts((current)=>({...current,[id]:{...(current[id]??emptyDraft()),...patch}}))}
  const toggleDocument=(id:string,documentId:string,checked:boolean)=>update(id,{
    document_ids:checked?[...(drafts[id]?.document_ids||[]),documentId]:(drafts[id]?.document_ids||[]).filter((value)=>value!==documentId),
  })

  const send=useMutation({
    mutationFn:()=>{const payload={organizationId,jobId:job.id,title,message,
      recipientName:recipientName||undefined,recipientEmail,expiryDays,
      contactId:clientContacts.find((contact)=>contact.email===recipientEmail)?.id,
      items:sendable.map((entry)=>{
        const draft=drafts[entry.jobCandidateId]??emptyDraft()
        return {job_candidate_id:entry.jobCandidateId,
          /* Falls back to a generated line rather than sending an empty summary -- the review page
           * leads with it, and a blank heading reads as a broken package. */
          candidate_summary:draft.candidate_summary.trim()||`${entry.name} — ${entry.row?.candidates?.current_position||'Experienced candidate'}${entry.row?.candidates?.current_company?` at ${entry.row.candidates.current_company}`:''}.`,
          recruiter_comments:draft.recruiter_comments.trim()||undefined,
          expected_salary:draft.expected_salary.trim()||undefined,
          currency:draft.expected_salary.trim()?draft.currency.trim()||job.currency||undefined:undefined,
          notice_period:draft.notice_period.trim()||undefined,
          availability:draft.availability.trim()||undefined,
          document_ids:draft.document_ids}
      })};const fingerprint=JSON.stringify(payload);if(fingerprint!==requestFingerprint.current){requestFingerprint.current=fingerprint;requestKey.current=crypto.randomUUID()}return sendClientSubmission({...payload,requestKey:requestKey.current})},
    onSuccess:async(result)=>{
      if(result.deliveryStatus==='failed')toast.error(new Error(result.errorMessage||'Email delivery failed.'),'The shortlist is saved. Retry the email from this job.')
      else toast.success(`${sendable.length} candidate${sendable.length===1?'':'s'} sent to ${recipientName||recipientEmail}.`,`One review link, expiring in ${expiryDays} days.`)
      requestKey.current='';requestFingerprint.current='';onClose();await onSent()
    },
    onError:(error)=>toast.error(error,'The submission was not created.'),
  })

  const dirty=edited||Boolean(recipientEmail)

  return <Drawer title="Send to client" description={`${job.title}${job.companies?.name?` · ${job.companies.name}`:''}`} eyebrow="Shortlist" open={open} onClose={onClose}
    dirty={dirty&&!send.isPending} discardMessage="Discard this submission?">
    <div className="stack">
      {blocked.length>0&&<Callout tone="warning" title={`${blocked.length} candidate${blocked.length===1?'':'s'} cannot be sent`}>
        {blocked.map((entry)=>entry.name).join(', ')} {blocked.length===1?'has':'have'} not granted consent to be represented, or {blocked.length===1?'is':'are'} marked do not contact. Update the record{blocked.length===1?'':'s'} first — they will not be included.
      </Callout>}

      <section className="composer-roster">
        <h3>Candidates</h3>
        {resolved.map((entry)=><CollapsibleSection key={entry.jobCandidateId} className="composer-candidate" defaultOpen={resolved.length===1}
          title={entry.name} badge={entry.blocked?<Badge tone="warn">Blocked</Badge>:entry.documents.length>0?<Badge>{entry.documents.length} file{entry.documents.length===1?'':'s'}</Badge>:undefined}>
          {entry.blocked
            ?<p className="muted">This candidate is excluded from the package.</p>
            :<div className="stack">
              <Field label="Summary the client sees first"><Textarea rows={2} value={drafts[entry.jobCandidateId]?.candidate_summary??''} onChange={(event)=>update(entry.jobCandidateId,{candidate_summary:event.target.value})} placeholder={`${entry.name} — ${entry.row?.candidates?.current_position||'Experienced candidate'}`}/></Field>
              <Field label="Your comments"><Textarea rows={2} value={drafts[entry.jobCandidateId]?.recruiter_comments??''} onChange={(event)=>update(entry.jobCandidateId,{recruiter_comments:event.target.value})} placeholder="What should the client know before speaking with them?"/></Field>
              {/* Read-only, and sent as shown. These come from the candidate record; editing them
                * here would create a second copy that disagrees with the source the moment either
                * one changes. The link goes to the place that owns them. */}
              <dl className="composer-facts">
                <div><dt>Expected salary</dt><dd>{factSalary(drafts[entry.jobCandidateId])}</dd></div>
                <div><dt>Notice period</dt><dd>{drafts[entry.jobCandidateId]?.notice_period||'Not recorded'}</dd></div>
                <div><dt>Availability</dt><dd>{candidateAvailability.label(drafts[entry.jobCandidateId]?.availability)||'Not recorded'}</dd></div>
              </dl>
              {entry.row?.candidate_id&&<p className="muted"><Link to={`${candidateBase}/${entry.row.candidate_id}`}>Edit these on {entry.name}'s record</Link></p>}
              <fieldset>
                <legend>Documents to share</legend>
                <div className="checkbox-list">
                  {entry.documents.map((document)=><label key={document.id}>
                    <input type="checkbox" checked={(drafts[entry.jobCandidateId]?.document_ids||[]).includes(document.id)} onChange={(event)=>toggleDocument(entry.jobCandidateId,document.id,event.target.checked)}/>
                    <span><FileText size={14}/>{document.original_filename||document.file_name}</span>
                  </label>)}
                  {entry.documents.length===0&&<p className="muted">No documents on this candidate. The written summary is still sent.</p>}
                </div>
              </fieldset>
            </div>}
        </CollapsibleSection>)}
      </section>

      <section className="stack">
        <h3>The email</h3>
        {clientContacts.length>0&&<Field label="Client contact"><Select defaultValue="" onChange={(event)=>{const contact=clientContacts.find((entry)=>entry.id===event.target.value);setRecipientName(contact?.full_name||'');setRecipientEmail(contact?.email||'')}}>
          <option value="">Select a suggested contact</option>
          {clientContacts.map((contact)=><option key={contact.id} value={contact.id}>{contact.full_name}{contact.position?` · ${contact.position}`:''}</option>)}
        </Select></Field>}
        <div className="form-grid">
          <Field label="Recipient name"><Input value={recipientName} onChange={(event)=>setRecipientName(event.target.value)}/></Field>
          <Field label="Recipient email"><Input type="email" value={recipientEmail} onChange={(event)=>setRecipientEmail(event.target.value)}/></Field>
        </div>
        <Field label="Package title"><Input value={title} onChange={(event)=>{setEdited(true);setTitle(event.target.value)}}/></Field>
        <Field label="Message"><Textarea value={message} onChange={(event)=>{setEdited(true);setMessage(event.target.value)}}/></Field>
        <Field label="Link expires after"><Select value={String(expiryDays)} onChange={(event)=>{setEdited(true);setExpiryDays(Number(event.target.value))}}>
          {[3,7,14,30].map((days)=><option key={days} value={days}>{days} days</option>)}
        </Select></Field>
      </section>

      {send.error&&<p className="form-error" role="alert">{send.error.message}</p>}
      <div className="form-actions">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button loading={send.isPending} disabled={!recipientEmail||!title.trim()||sendable.length===0} onClick={()=>send.mutate()}>
          Send {sendable.length} candidate{sendable.length===1?'':'s'}
        </Button>
      </div>
    </div>
  </Drawer>
}
