export const candidateCvJsonSchema={
  type:'object',additionalProperties:false,
  required:['full_name','current_company','current_position','location','linkedin_url','portfolio_url','source','availability','private','employment','education','skills','languages','field_evidence','uncertainties'],
  properties:{
    full_name:{type:'string'},current_company:nullableString(),current_position:nullableString(),location:nullableString(),linkedin_url:nullableString(),portfolio_url:nullableString(),source:nullableString(),availability:nullableString(),notice_period_days:nullableNumber(true),
    private:{type:'object',additionalProperties:false,required:['email','phone','salary_currency','work_authorization'],properties:{email:nullableString(),phone:nullableString(),current_salary:nullableNumber(),expected_salary:nullableNumber(),salary_currency:nullableString(),work_authorization:nullableString()}},
    employment:{type:'array',items:{type:'object',additionalProperties:false,required:['company_name','title','location','is_current','summary','sort_order'],properties:{company_name:{type:'string'},title:{type:'string'},location:nullableString(),started_on:nullableDate(),ended_on:nullableDate(),is_current:{type:'boolean'},summary:nullableString(),started_on_precision:nullablePrecision(),ended_on_precision:nullablePrecision(),sort_order:{type:'integer'}}}},
    education:{type:'array',items:{type:'object',additionalProperties:false,required:['institution','degree','field_of_study','sort_order'],properties:{institution:{type:'string'},degree:nullableString(),field_of_study:nullableString(),started_on:nullableDate(),ended_on:nullableDate(),started_on_precision:nullablePrecision(),ended_on_precision:nullablePrecision(),sort_order:{type:'integer'}}}},
    skills:{type:'array',items:{type:'object',additionalProperties:false,required:['name','proficiency'],properties:{name:{type:'string'},proficiency:nullableString(),years_experience:nullableNumber()}}},
    languages:{type:'array',items:{type:'object',additionalProperties:false,required:['language','proficiency'],properties:{language:{type:'string'},proficiency:nullableString()}}},
    field_evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['path','confidence','evidence'],properties:{path:{type:'string'},confidence:{type:'string',enum:['high','medium','low']},evidence:nullableString()}}},
    uncertainties:{type:'array',items:{type:'string'}},
  },
} as const

function nullableString(){return {type:'string'} as const}
function nullableNumber(integer=false){return {type:integer?'integer':'number'} as const}
function nullableDate(){return {type:'string'} as const}
function nullablePrecision(){return {type:'string',enum:['day','month','year']} as const}

export interface CvExtraction {
  full_name:string;current_company:string|null;current_position:string|null;location:string|null;linkedin_url:string|null;portfolio_url:string|null;source:string|null;availability:string|null;notice_period_days:number|null;
  private:{email:string|null;phone:string|null;current_salary:number|null;expected_salary:number|null;salary_currency:string|null;work_authorization:string|null};
  employment:Record<string,unknown>[];education:Record<string,unknown>[];skills:Record<string,unknown>[];languages:Record<string,unknown>[];
  field_evidence:{path:string;confidence:'high'|'medium'|'low';evidence:string|null}[];uncertainties:string[];
}

export function normalizeCvExtraction(value:unknown):CvExtraction{
  if(!value||typeof value!=='object')throw new Error('Invalid extraction result.')
  const candidate=value as CvExtraction
  if(typeof candidate.full_name!=='string'||!candidate.private||!Array.isArray(candidate.employment)||!Array.isArray(candidate.education)||!Array.isArray(candidate.skills)||!Array.isArray(candidate.languages)||!Array.isArray(candidate.field_evidence)||!Array.isArray(candidate.uncertainties))throw new Error('Incomplete extraction result.')
  return {...candidate,employment:candidate.employment.map((item)=>normalizeTimeline(item,true)),education:candidate.education.map((item)=>normalizeTimeline(item,false))}
}

function normalizeTimeline(item:Record<string,unknown>,supportsCurrent:boolean):Record<string,unknown>{
  const isCurrent=supportsCurrent&&item.is_current===true
  const startedOn=validDate(item.started_on)
  const endedOn=isCurrent?null:validDate(item.ended_on)
  return {...item,started_on:startedOn,ended_on:endedOn,started_on_precision:validPrecision(item.started_on_precision,startedOn),ended_on_precision:validPrecision(item.ended_on_precision,endedOn)}
}

function validDate(value:unknown):string|null{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
  const year=Number(value.slice(0,4));const month=Number(value.slice(5,7));const day=Number(value.slice(8,10))
  const date=new Date(Date.UTC(year,month-1,day))
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?value:null
}

function validPrecision(value:unknown,date:string|null):'day'|'month'|'year'|null{
  return date&&['day','month','year'].includes(String(value))?value as 'day'|'month'|'year':null
}
