import {useMemo,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import Papa from 'papaparse'
import {readSheet} from 'read-excel-file/browser'
import {Download,FileCheck2,FileUp,RotateCcw} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {Callout} from '../../shared/ui/Callout'
import {commitImport,listImportBatches,listImportErrors,rollbackImport,setMigrationComplete,stageImport} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {ConfirmDialog} from '../../shared/ui/ConfirmDialog'
import {Field,Select} from '../../shared/ui/Field'
import {Badge,Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {importStatus} from '../../shared/lib/status'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {formatDateTime} from '../../shared/lib/format'
import {Table} from '../../shared/ui/Table'
import {useToast} from '../../shared/ui/Toast'
import type {ImportBatch} from '../../shared/types/domain'

const entityHeaders:Record<string,string[]>= {
  candidates:['legacy_id','full_name','email','phone','current_company','current_position','location','linkedin_url','status','source','availability','notice_period_days','current_salary','expected_salary','salary_currency','work_authorization','consent_status','owner_email'],
  candidate_employment:['legacy_id','candidate_legacy_id','company_name','title','location','started_on','ended_on','is_current','summary'],
  candidate_education:['legacy_id','candidate_legacy_id','institution','degree','field_of_study','started_on','ended_on'],
  candidate_languages:['legacy_id','candidate_legacy_id','language','proficiency'],
  companies:['legacy_id','name','industry','website','location','company_size','account_status','business_development_stage','notes_summary','owner_email'],
  contacts:['legacy_id','company_legacy_id','full_name','position','email','phone','linkedin_url','contact_status','decision_authority','next_follow_up_at','owner_email'],
  jobs:['legacy_id','company_legacy_id','title','description','requirements','location','employment_type','salary_min','salary_max','priority','status','currency','placement_fee_percentage','fixed_fee','target_close_date','internal_notes','client_visible_notes','owner_email','primary_contact_legacy_id','team_member_emails'],
  job_candidates:['legacy_id','candidate_legacy_id','job_legacy_id','stage','stage_occurred_at','source','owner_email'],
  submissions:['legacy_id','job_legacy_id','contact_legacy_id','job_candidate_legacy_ids','title','message','recipient_name','recipient_email','expiry_days'],
  tasks:['legacy_id','title','description','priority','status','due_at','owner_email','candidate_legacy_id','company_legacy_id','contact_legacy_id','job_legacy_id'],
  activities:['legacy_id','activity_type','direction','subject','summary','occurred_at','owner_email','candidate_legacy_id','company_legacy_id','contact_legacy_id','job_legacy_id'],
  interviews:['legacy_id','job_candidate_legacy_id','interview_type','starts_at','ends_at','timezone','location','meeting_url','status'],
  offers:['legacy_id','job_candidate_legacy_id','salary','currency','offered_at','start_date','status','notes'],
  placements:['legacy_id','job_candidate_legacy_id','start_date','salary','placement_fee','currency','guarantee_days','status'],
  revenue_splits:['legacy_id','placement_legacy_id','member_email','split_percentage'],
  invoices:['legacy_id','placement_legacy_id','invoice_reference','amount','currency','issued_on','due_on','status','paid_on','notes'],
}

export function ImportsPage(){
  const {organization,refresh:refreshOrganization}=useOrganization();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [entityType,setEntityType]=useState('candidates');const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState<Array<Record<string,unknown>>>([]);const [sourceHeaders,setSourceHeaders]=useState<string[]>([]);const [mapping,setMapping]=useState<Record<string,string>>({});const [parseError,setParseError]=useState('')
  // Rollback deletes rows that were already committed, so it asks first and names the batch.
  const [rollbackTarget,setRollbackTarget]=useState<ImportBatch|null>(null)
  const batches=useQuery({queryKey:['imports',organization?.id],enabled:Boolean(organization),queryFn:()=>listImportBatches(organization!.id)});const refresh=()=>cache.invalidateQueries({queryKey:['imports',organization?.id]});const mappedRows=useMemo(()=>preview.map((row)=>Object.fromEntries((entityHeaders[entityType]||[]).map((target)=>[target,mapping[target]?row[mapping[target]]??null:null]))),[entityType,mapping,preview]);const stage=useMutation({mutationFn:()=>stageImport(organization!.id,entityType,file!.name,file!.name.toLowerCase().endsWith('.xlsx')?'xlsx':'csv',mappedRows),onSuccess:async()=>{toast.success(`${mappedRows.length} rows staged.`,'Nothing is written until you review the dry run and commit.');resetFile();await refresh()},onError:(error)=>toast.error(error,'Nothing was staged and no records were written.')});const commit=useMutation({mutationFn:(id:string)=>commitImport(organization!.id,id),onSuccess:async()=>{toast.success('Batch committed.','Re-committing the same batch is safe -- it will not duplicate records.');await refresh()},onError:(error)=>toast.error(error,'The batch was not committed.')});const rollback=useMutation({mutationFn:(id:string)=>rollbackImport(organization!.id,id,'Owner requested rollback from import center.'),onSuccess:async()=>{toast.success('Batch rolled back.','Records edited since the import were left alone.');setRollbackTarget(null);await refresh()},onError:(error)=>toast.error(error,'Nothing was rolled back.')})
  /* The migration is a week of work on a product that lives for years. Marking it complete hides
   * this page's tile from Admin so the rollback control below stops sitting in a nav -- the route
   * stays reachable, and the flag can be cleared again for a correction run. */
  const migrationComplete=organization?.migration_complete===true
  const signOff=useMutation({mutationFn:(complete:boolean)=>setMigrationComplete(organization!.id,complete),onSuccess:async(_result,complete)=>{toast.success(complete?'Migration marked complete.':'Imports reopened.',complete?'The Imports tile is hidden from Admin. This page stays reachable by URL.':'The Imports tile is back in Admin.');await refreshOrganization()},onError:(error)=>toast.error(error,'The migration status was not changed.')})
  function resetFile(){setFile(null);setPreview([]);setSourceHeaders([]);setMapping({})}
  async function chooseFile(selected:File|null){setFile(selected);setPreview([]);setParseError('');if(!selected)return;try{let rows:Array<Record<string,unknown>>=[];if(selected.name.toLowerCase().endsWith('.xlsx')){const matrix=await readSheet(selected);rows=matrixToRecords(matrix)}else{const parsed=Papa.parse<Record<string,unknown>>(await selected.text(),{header:true,skipEmptyLines:true,transformHeader:normalizeHeader});if(parsed.errors.length)throw new Error(parsed.errors[0]?.message||'CSV parsing failed.');rows=parsed.data}if(!rows.length)throw new Error('The selected file has no data rows.');const headers=Object.keys(rows[0]||{});setSourceHeaders(headers);setMapping(Object.fromEntries((entityHeaders[entityType]||[]).map((target)=>[target,headers.includes(target)?target:''])));setPreview(rows)}catch(error){setParseError(error instanceof Error?error.message:'Could not read the selected file.')}}
  async function downloadErrors(importId:string){const rows=await listImportErrors(organization!.id,importId);const csv=Papa.unparse(rows.map((row)=>({row_number:row.row_number,errors:JSON.stringify(row.errors),source:JSON.stringify(row.source_data)})));download(`${importId}-errors.csv`,csv)}
  if(batches.isLoading)return <LoadingState/>;if(batches.error)return <ErrorState error={batches.error}/>
  return <Page title="Data imports" eyebrow="Controlled migration" description="Dry-run Excel or CSV worksheets, map columns, reconcile legacy references, commit idempotently, and roll back by batch.">
    {capabilities.data?.canManageOrganization&&<Callout tone={migrationComplete?'success':'info'}
      title={migrationComplete?'Migration signed off':'Migration in progress'}
      action={<Button variant={migrationComplete?'secondary':'primary'} loading={signOff.isPending} onClick={()=>signOff.mutate(!migrationComplete)}>{migrationComplete?'Reopen imports':'Mark migration complete'}</Button>}>
      {migrationComplete
        ?'This page is hidden from Admin and reachable only by URL. Reopen it if you need another correction run.'
        :'While this is set, Data imports appears as a tile in Admin. Mark it complete after the cutover so the rollback control stops sitting in the navigation.'}
    </Callout>}
    <Panel title="Stage an Excel or CSV batch"><div className="form-grid"><Field label="Entity type"><Select value={entityType} onChange={(event)=>{setEntityType(event.target.value);resetFile()}}>{Object.keys(entityHeaders).map((entity)=><option key={entity} value={entity}>{entity.replaceAll('_',' ')}</option>)}</Select></Field><Field label="File"><input className="file-input" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void chooseFile(event.target.files?.[0]||null)}/></Field><div className="full"><strong>Required migration contract</strong><p className="muted">Every row needs a stable <code>legacy_id</code>. Dependent worksheets refer to the parent worksheet's legacy ID; import parent batches first.</p></div>{sourceHeaders.length>0&&<div className="full"><strong>Column mapping</strong><div className="mapping-grid">{(entityHeaders[entityType]||[]).map((target)=><Field label={target} key={target}><Select value={mapping[target]||''} onChange={(event)=>setMapping((current)=>({...current,[target]:event.target.value}))}><option value="">Not supplied</option>{sourceHeaders.map((header)=><option value={header} key={header}>{header}</option>)}</Select></Field>)}</div></div>}{parseError&&<p className="form-error full" role="alert">{parseError}</p>}{preview.length>0&&<div className="success-box full"><FileCheck2 size={16}/> {preview.length} rows ready for server-side dry-run validation from {file?.name}.</div>}<div className="form-actions full"><Button loading={stage.isPending} disabled={!file||!preview.length||!mapping.legacy_id} leadingIcon={<FileUp size={15}/>} onClick={()=>stage.mutate()}>{'Stage and validate'}</Button></div>{stage.error&&<p className="form-error full" role="alert">{stage.error.message}</p>}</div></Panel><Panel title="Migration batches">{batches.data?.length===0?<EmptyState title="No import batches" description="Start with companies and candidates, then import dependent worksheets in legacy-reference order."/>:<Table headers={['File','Entity','Rows','Status','Reconciliation','Actions']}>{batches.data?.map((batch)=><tr key={batch.id}><td><strong>{batch.file_name}</strong><span>{formatDateTime(batch.created_at)}</span></td><td>{batch.entity_type.replaceAll('_',' ')}</td><td>{batch.valid_rows}/{batch.total_rows}{batch.failed_rows>0&&<Badge tone="bad">{batch.failed_rows} invalid</Badge>}</td><td><StatusBadge map={importStatus} value={batch.status}/></td><td>{batch.status==='completed'?`${String(batch.reconciliation_summary.committedRows??batch.valid_rows)} committed / ${String(batch.reconciliation_summary.existingLegacyIds??0)} existing`:'—'}</td><td><div className="table-actions">{batch.failed_rows>0&&<Button variant="secondary" leadingIcon={<Download size={14}/>} onClick={()=>void downloadErrors(batch.id)}>Errors</Button>}{batch.status==='ready'&&<Button loading={commit.isPending} onClick={()=>commit.mutate(batch.id)}>Approve & commit</Button>}{['completed','failed'].includes(batch.status)&&<Button variant="danger" leadingIcon={<RotateCcw size={14}/>} onClick={()=>setRollbackTarget(batch)}>Rollback</Button>}</div></td></tr>)}</Table>}{(commit.error||rollback.error)&&<p className="form-error" role="alert">{(commit.error||rollback.error)?.message}</p>}</Panel>
    <ConfirmDialog open={Boolean(rollbackTarget)} title="Roll back this import?" confirmLabel="Roll back" loading={rollback.isPending}
      onClose={()=>setRollbackTarget(null)} onConfirm={()=>{if(rollbackTarget)rollback.mutate(rollbackTarget.id)}}
      body={rollbackTarget?<><p>This deletes the <strong>{rollbackTarget.valid_rows} {rollbackTarget.entity_type.replaceAll('_',' ')}</strong> records committed from <strong>{rollbackTarget.file_name}</strong> on {formatDateTime(rollbackTarget.completed_at||rollbackTarget.created_at)}.</p><p className="muted">Anything edited since the import was committed is deleted too. This cannot be undone.</p></>:null}/>
  </Page>
}

const normalizeHeader=(header:string)=>header.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
function matrixToRecords(matrix:Array<Array<unknown>>){const [headerRow,...rows]=matrix;if(!headerRow)return [];const headers=headerRow.map((value)=>normalizeHeader(String(value??'')));return rows.filter((row)=>row.some((value)=>value!==null&&value!=='')).map((row)=>Object.fromEntries(headers.map((header,index)=>[header,row[index]??null])))}
function download(filename:string,content:string){const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url)}
