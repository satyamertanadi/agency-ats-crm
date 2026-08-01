import {CheckSquare} from 'lucide-react'
import {useSearchParams} from 'react-router'
import {Button} from '../../shared/ui/Button'

type LinkType='candidate'|'company'|'contact'|'job'

export function TaskButton({linkType,linkId,label='Add task',variant='secondary'}:{linkType:LinkType;linkId:string;label?:string;variant?:'primary'|'secondary'|'quiet'}){
  const [params,setParams]=useSearchParams()
  const open=()=>{const next=new URLSearchParams(params);next.set('task','1');next.set('linkType',linkType);next.set('linkId',linkId);setParams(next,{replace:true})}
  return <Button variant={variant} leadingIcon={<CheckSquare size={14}/>} onClick={open}>{label}</Button>
}
