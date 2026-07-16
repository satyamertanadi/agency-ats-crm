import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Plus} from 'lucide-react'
import {useState} from 'react'
import {useOrganization} from '../../app/OrganizationProvider'
import {archiveCandidateProfileTemplate,hasOrganizationPermission,listCandidateProfileTemplates,saveCandidateProfileTemplate} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Page,Panel,Badge} from '../../shared/ui/Page'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import type {CandidateProfileTemplate,CandidateProfileTemplateConfig} from '../candidates/candidateProfile'
import {CandidateProfileTemplateEditor} from './CandidateProfileTemplateEditor'

export function TemplatesPage(){
  const {organization}=useOrganization();const organizationId=organization!.id;const cache=useQueryClient();const [selectedId,setSelectedId]=useState<string|null>(null);const [creating,setCreating]=useState(false)
  const templates=useQuery({queryKey:['candidate-profile-templates',organizationId],queryFn:()=>listCandidateProfileTemplates(organizationId)})
  const manage=useQuery({queryKey:['permission',organizationId,'organization.manage'],queryFn:()=>hasOrganizationPermission(organizationId,'organization.manage')})
  const refresh=()=>cache.invalidateQueries({queryKey:['candidate-profile-templates',organizationId]})
  const save=useMutation({mutationFn:(value:{id?:string;name:string;configuration:CandidateProfileTemplateConfig;isDefault:boolean})=>saveCandidateProfileTemplate(organizationId,value),onSuccess:async(id)=>{setCreating(false);setSelectedId(id);await refresh()}})
  const archive=useMutation({mutationFn:(id:string)=>archiveCandidateProfileTemplate(organizationId,id),onSuccess:async()=>{setSelectedId(null);await refresh()}})
  if(templates.isLoading||manage.isLoading)return <LoadingState/>;if(templates.error||manage.error)return <ErrorState error={templates.error||manage.error}/>
  const selected=(templates.data||[]).find((item)=>item.id===selectedId)||templates.data?.[0]||null
  return <Page title="Client profile templates" eyebrow="Reusable content" description="Control branding, language, anonymization, and section order for reviewed candidate profiles." actions={manage.data?<Button leadingIcon={<Plus size={14}/>} onClick={()=>{setCreating(true);setSelectedId(null)}}>New template</Button>:undefined}>
    <div className="two-column template-layout"><Panel title="Templates" subtitle="One controlled layout keeps DOCX and PDF output consistent."><div className="list">{templates.data?.map((template)=><button className={`list-row template-list-item ${!creating&&selected?.id===template.id?'active':''}`} key={template.id} onClick={()=>{setCreating(false);setSelectedId(template.id)}}><span><strong>{template.name}</strong><small>{template.configuration.output_language==='id'?'Bahasa Indonesia':'English'} · Version {template.version}</small></span>{template.is_default&&<Badge tone="good">Default</Badge>}</button>)}</div></Panel>
      <Panel title={creating?'New candidate profile template':selected?.name||'Candidate profile template'}>{(creating||selected)&&<CandidateProfileTemplateEditor key={creating?'new':selected?.id} template={creating?null:selected as CandidateProfileTemplate} canManage={Boolean(manage.data)} saving={save.isPending} onSave={(value)=>save.mutate(value)} onArchive={selected?()=>archive.mutate(selected.id):undefined}/>} {save.error&&<p className="form-error" role="alert">{save.error.message}</p>}{archive.error&&<p className="form-error" role="alert">{archive.error.message}</p>}</Panel>
    </div>
  </Page>
}
