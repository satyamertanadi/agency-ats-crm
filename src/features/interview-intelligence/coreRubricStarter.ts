import type {CoreRubricItemInput} from './adminRepository'

/* A starting point for the agency core rubric, not a standard.
 *
 * The core rubric is where an agency writes down what it means by a well-run interview, and that is
 * genuinely theirs to decide -- a search firm placing CFOs and a volume desk filling warehouse roles
 * do not agree on what good looks like. So this is a draft to argue with: every item is editable
 * before activation, and the panel says so rather than presenting these as recommended.
 *
 * The five dimensions are fixed by the analysis contract; what varies is the criteria under them.
 * Each item is phrased as an observable behaviour rather than a quality, because a criterion that
 * cannot be checked against a transcript produces a finding nobody can verify -- "built rapport"
 * is a judgement, "opened by explaining the role and the process" is something that either happened
 * or did not.
 */
export const CORE_RUBRIC_STARTER:CoreRubricItemInput[]=[
  {
    dimension:'essential_coverage',
    item_type:'quality_criterion',
    label:'Covered every must-have requirement on the role',
    question_text:null,
    evidence_expected:'Each must-have requirement in the job blueprint was raised and the candidate responded to it.',
    requirement_level:'must_have',
  },
  {
    dimension:'essential_coverage',
    item_type:'quality_criterion',
    label:'Established current situation and reason for moving',
    question_text:null,
    evidence_expected:'The candidate stated why they are looking and what would make them leave their current role.',
    requirement_level:'must_have',
  },
  {
    dimension:'essential_coverage',
    item_type:'quality_criterion',
    label:'Confirmed the practical constraints',
    question_text:null,
    evidence_expected:'Notice period, location or travel expectations, and salary expectations were each covered.',
    requirement_level:'must_have',
  },
  {
    dimension:'question_quality',
    item_type:'quality_criterion',
    label:'Asked for specific examples rather than accepting general claims',
    question_text:null,
    evidence_expected:'Where the candidate described a skill in general terms, the consultant asked for a concrete instance.',
    requirement_level:'must_have',
  },
  {
    dimension:'question_quality',
    item_type:'quality_criterion',
    label:'Followed up on incomplete or evasive answers',
    question_text:null,
    evidence_expected:'An answer that did not address the question was returned to rather than left.',
    requirement_level:'must_have',
  },
  {
    dimension:'question_quality',
    item_type:'quality_criterion',
    label:'Avoided leading and compound questions',
    question_text:null,
    evidence_expected:'Questions did not supply the expected answer, and did not bundle several questions into one turn.',
    requirement_level:'nice_to_have',
  },
  {
    dimension:'listening_balance',
    item_type:'quality_criterion',
    label:'Left the candidate room to answer',
    question_text:null,
    evidence_expected:'The candidate completed their answers without being cut off mid-point.',
    requirement_level:'must_have',
  },
  {
    dimension:'listening_balance',
    item_type:'quality_criterion',
    label:'Built on what the candidate said',
    question_text:null,
    evidence_expected:'At least some questions referred back to something the candidate had raised earlier.',
    requirement_level:'nice_to_have',
  },
  {
    dimension:'role_presentation',
    item_type:'quality_criterion',
    label:'Described the role and the client accurately',
    question_text:null,
    evidence_expected:'The role, the team and the client were described in terms consistent with the job brief.',
    requirement_level:'must_have',
  },
  {
    dimension:'role_presentation',
    item_type:'quality_criterion',
    label:'Was straight about the difficult parts',
    question_text:null,
    evidence_expected:'Known challenges of the role -- travel, workload, reporting line, stage of the business -- were raised rather than left for later.',
    requirement_level:'nice_to_have',
  },
  {
    dimension:'next_step_clarity',
    item_type:'quality_criterion',
    label:'Stated what happens next and by when',
    question_text:null,
    evidence_expected:'The candidate was told the next step and a timeframe for hearing back.',
    requirement_level:'must_have',
  },
  {
    dimension:'next_step_clarity',
    item_type:'quality_criterion',
    label:'Gave the candidate space to ask questions',
    question_text:null,
    evidence_expected:'The candidate was invited to ask questions and their questions were answered.',
    requirement_level:'nice_to_have',
  },
]

export const CORE_RUBRIC_STARTER_NAME='Agency core rubric'
