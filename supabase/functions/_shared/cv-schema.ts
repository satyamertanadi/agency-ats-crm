export const candidateCvJsonSchema={
  type:'object',additionalProperties:false,
  required:['full_name','current_company','current_position','location','linkedin_url','portfolio_url','source','availability','notice_period_days','private','employment','education','skills','languages','field_evidence','uncertainties'],
  properties:{
    full_name:{type:'string'},current_company:nullableString(),current_position:nullableString(),location:nullableString(),linkedin_url:nullableString(),portfolio_url:nullableString(),source:nullableString(),availability:nullableString(),notice_period_days:nullableNumber(true),
    private:{type:'object',additionalProperties:false,required:['email','phone','current_salary','expected_salary','salary_currency','work_authorization'],properties:{email:nullableString(),phone:nullableString(),current_salary:nullableNumber(),expected_salary:nullableNumber(),salary_currency:nullableString(),work_authorization:nullableString()}},
    employment:{type:'array',items:{type:'object',additionalProperties:false,required:['company_name','title','location','started_on','ended_on','is_current','summary','started_on_precision','ended_on_precision','sort_order'],properties:{company_name:{type:'string'},title:{type:'string'},location:nullableString(),started_on:nullableDate(),ended_on:nullableDate(),is_current:{type:'boolean'},summary:nullableString(),started_on_precision:nullablePrecision(),ended_on_precision:nullablePrecision(),sort_order:{type:'integer'}}}},
    education:{type:'array',items:{type:'object',additionalProperties:false,required:['institution','degree','field_of_study','started_on','ended_on','started_on_precision','ended_on_precision','sort_order'],properties:{institution:{type:'string'},degree:nullableString(),field_of_study:nullableString(),started_on:nullableDate(),ended_on:nullableDate(),started_on_precision:nullablePrecision(),ended_on_precision:nullablePrecision(),sort_order:{type:'integer'}}}},
    skills:{type:'array',items:{type:'object',additionalProperties:false,required:['name','proficiency','years_experience'],properties:{name:{type:'string'},proficiency:nullableString(),years_experience:nullableNumber()}}},
    languages:{type:'array',items:{type:'object',additionalProperties:false,required:['language','proficiency'],properties:{language:{type:'string'},proficiency:nullableString()}}},
    field_evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['path','confidence','evidence'],properties:{path:{type:'string'},confidence:{type:'string',enum:['high','medium','low']},evidence:nullableString()}}},
    uncertainties:{type:'array',items:{type:'string'}},
  },
} as const

function nullableString(){return {type:['string','null']} as const}
function nullableNumber(integer=false){return {type:integer?['integer','null']:['number','null']} as const}
function nullableDate(){return {type:['string','null'],pattern:'^\\d{4}-\\d{2}-\\d{2}$'} as const}
function nullablePrecision(){return {type:['string','null'],enum:['day','month','year',null]} as const}

export interface CvExtraction {
  full_name:string;current_company:string|null;current_position:string|null;location:string|null;linkedin_url:string|null;portfolio_url:string|null;source:string|null;availability:string|null;notice_period_days:number|null;
  private:{email:string|null;phone:string|null;current_salary:number|null;expected_salary:number|null;salary_currency:string|null;work_authorization:string|null};
  employment:Record<string,unknown>[];education:Record<string,unknown>[];skills:Record<string,unknown>[];languages:Record<string,unknown>[];
  field_evidence:{path:string;confidence:'high'|'medium'|'low';evidence:string|null}[];uncertainties:string[];
}
