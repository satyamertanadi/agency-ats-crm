import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useOrganization } from '../../app/OrganizationProvider'
import { searchWorkspace } from '../core/repository'
import { Input } from '../../shared/ui/Field'
import { Badge,Page,Panel } from '../../shared/ui/Page'
import { EmptyState,ErrorState,LoadingState } from '../../shared/ui/States'

export function SearchPage(){const {organization}=useOrganization();const [query,setQuery]=useState('');const search=useQuery({queryKey:['search',organization?.id,query],enabled:Boolean(organization&&query.trim().length>=2),queryFn:()=>searchWorkspace(organization!.id,query.trim())});return <Page title="Search" eyebrow="Workspace search" description="Structured PostgreSQL search across candidates, companies, contacts, and vacancies."><Panel><div className="toolbar"><div className="search-box"><Search size={16}/><Input autoFocus value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search people, client companies, contacts, and jobs"/></div></div>{query.trim().length<2?<EmptyState title="Search the workspace" description="Enter at least two characters."/>:search.isLoading?<LoadingState/>:search.error?<ErrorState error={search.error}/>:search.data?.length===0?<EmptyState title="No matching records" description="Try a different keyword or spelling."/>:<div className="list">{search.data?.map((result)=><article className="list-row" key={`${result.entity_type}-${result.entity_id}`}><div><strong>{result.title}</strong><span>{result.subtitle}</span></div><Badge tone="info">{result.entity_type}</Badge></article>)}</div>}</Panel></Page>}
