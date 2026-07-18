import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {formatMoney} from '../../shared/lib/format'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Panel} from '../../shared/ui/Page'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {listCompanyCommercialTerms,setCompanyDefaultFee} from '../core/commercialRepository'

export function CompanyCommercialTerms({organizationId,companyId,baseCurrency,canEdit}:{organizationId:string;companyId:string;baseCurrency:string;canEdit:boolean}){
  const cache=useQueryClient();const [editing,setEditing]=useState(false);const [feeType,setFeeType]=useState<'percentage'|'fixed'>('percentage');const [amount,setAmount]=useState('');const [currency,setCurrency]=useState(baseCurrency);const [guaranteeDays,setGuaranteeDays]=useState('90')
  const query=useQuery({queryKey:['company-commercial-terms',organizationId,companyId],queryFn:()=>listCompanyCommercialTerms(organizationId,companyId)})
  const mutation=useMutation({mutationFn:()=>setCompanyDefaultFee(organizationId,companyId,{feeType,feePercentage:feeType==='percentage'?Number(amount):undefined,fixedFee:feeType==='fixed'?Number(amount):undefined,currency,guaranteeDays:Number(guaranteeDays)}),onSuccess:async()=>{setEditing(false);await Promise.all([cache.invalidateQueries({queryKey:['company-commercial-terms',organizationId,companyId]}),cache.invalidateQueries({queryKey:['job-health',organizationId]})])}})
  if(query.isLoading)return <LoadingState label="Loading commercial terms…"/>;if(query.error)return <ErrorState error={query.error}/>
  const active=query.data?.find((term)=>term.status==='active')
  return <Panel title="Commercial terms" subtitle="Account-level defaults flow into job health unless a job has its own fee override." action={canEdit?<Button variant="secondary" onClick={()=>setEditing((value)=>!value)}>{editing?'Cancel':'Set defaults'}</Button>:undefined}>
    {editing?<form className="form-grid" onSubmit={(event)=>{event.preventDefault();mutation.mutate()}}><Field label="Fee type"><Select value={feeType} onChange={(event)=>setFeeType(event.target.value as 'percentage'|'fixed')}><option value="percentage">Percentage</option><option value="fixed">Fixed fee</option></Select></Field><Field label={feeType==='percentage'?'Percentage':'Amount'}><Input type="number" min="0" max={feeType==='percentage'?100:undefined} step={feeType==='percentage'?'0.001':'0.01'} value={amount} onChange={(event)=>setAmount(event.target.value)} required/></Field><Field label="Currency"><Input maxLength={3} value={currency} onChange={(event)=>setCurrency(event.target.value.toUpperCase())} required/></Field><Field label="Guarantee days"><Input type="number" min="0" max="730" value={guaranteeDays} onChange={(event)=>setGuaranteeDays(event.target.value)} required/></Field>{mutation.error&&<p className="form-error full" role="alert">{mutation.error.message}</p>}<div className="form-actions full"><Button loading={mutation.isPending} disabled={!amount||currency.length!==3}>Save defaults</Button></div></form>:active?<dl className="record-summary"><div><dt>Fee</dt><dd>{active.fee_type==='percentage'?`${active.fee_percentage}%`:formatMoney(active.fixed_fee,active.currency)}</dd></div><div><dt>Guarantee</dt><dd>{active.guarantee_days} days</dd></div><div><dt>Effective from</dt><dd>{active.effective_from}</dd></div><div><dt>Source</dt><dd>Account agreement</dd></div></dl>:<p className="muted">No account-level fee defaults recorded. Job-specific fees still apply.</p>}
  </Panel>
}
