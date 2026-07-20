import {describe,expect,it} from 'vitest'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import JSZip from 'jszip'
import {buildCandidateProfileDocx} from './candidateProfileDocx'
import {calculateEvidenceScore,candidateProfileDraftSchema,candidateProfileTemplateConfigSchema,defaultCandidateProfileTemplate,hasStaleProfileInputs} from './candidateProfile'
import {emptyProfileDetails,roleKey,type ProfileDetails} from './candidateProfileDetails'
import {buildCandidateProfileViewModel,formatEmploymentRange,profileFilename,relevanceFor,type ProfileCandidate} from './candidateProfileViewModel'

const draft=candidateProfileDraftSchema.parse({candidate_summary:['Experienced hospitality operator.','Evidence is limited to the supplied record.'],strengths_opportunities:'Direct property operations experience.',risks_challenges:'P&L ownership remains to be confirmed.',points_to_validate:['Confirm P&L ownership.'],experience_relevance:[{company_name:'Betterplace',title:'Hotel Manager',relevance:['Runs property operations.']}],requirement_evidence:[{requirement:'Property operations',classification:'matched',source:'candidate_record',source_path:'candidate.employment[0].title',excerpt:'Hotel Manager',explanation:'Current title supports operational experience.'},{requirement:'P&L ownership',classification:'missing',source:'none',source_path:'',excerpt:'',explanation:'No supplied fact confirms P&L ownership.'}],score:50})
const candidate:ProfileCandidate={full_name:'Franco George Wenas',current_position:'Hotel Manager',current_company:'Betterplace',location:'Bali, Indonesia',employment:[{company_name:'Betterplace',title:'Hotel Manager',started_on:'2025-11-01',ended_on:null,started_on_precision:'month',ended_on_precision:null,is_current:true}],education:[{degree:'Diploma III',field_of_study:'Hotel Management',institution:'AKPAR NHI'}],languages:['Indonesian','English','Italian']}
const filled:ProfileDetails={...emptyProfileDetails(),age:'40',nationality:'Indonesian',current_salary:'To be confirmed',expected_salary:'To be confirmed'}

function view(options:{anonymized?:boolean;language?:'en'|'id';details?:ProfileDetails;websites?:Record<string,string>}={}){
  return buildCandidateProfileViewModel({candidate,job:{title:'Operations Manager',company_name:'House of Kairos'},draft,template:defaultCandidateProfileTemplate(options.language||'en'),preparedBy:'Felina Kuswanto',preparedDate:'June 2026',organizationName:'Agency ATS',accent:'#196f52',anonymized:Boolean(options.anonymized),details:options.details||filled,websites:options.websites})
}
async function documentXml(blob:Blob){const zip=await JSZip.loadAsync(await blob.arrayBuffer());return zip.file('word/document.xml')!.async('string')}
async function partXml(blob:Blob,path:string){const zip=await JSZip.loadAsync(await blob.arrayBuffer());return zip.file(path)?.async('string')||''}
// Entities are decoded so assertions read as the text Word shows -- "Risks & Challenge", not "&amp;".
const decode=(value:string)=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
const textRuns=(xml:string)=>[...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match)=>decode(match[1]!))

/* The client template is mandatory: a consultant may not send a profile that deviates from it, and
 * the whole point of this generator is that nobody has to rework the output by hand. So these
 * assertions pin the measurements taken from the approved .docx. A failure here means the generated
 * document no longer matches what the agency is contractually allowed to send. */
describe('mandatory client profile format',()=>{
  it('uses the approved A4 geometry on both the cover and body sections',async()=>{
    const xml=await documentXml(await buildCandidateProfileDocx(view()))
    expect(xml).toContain('<w:pgSz w:w="11910" w:h="16840"')
    // Cover runs to a zero bottom margin; the body reserves the band the footer banner occupies.
    expect(xml).toContain('w:top="1220" w:right="1260" w:bottom="0" w:left="1320"')
    expect(xml).toContain('w:top="1580" w:right="1260" w:bottom="2780" w:left="1320"')
  })

  it('states the seventeen information rows in the mandatory order',async()=>{
    // The highest-value assertion in this file: it fails on a reorder, a rename, or a dropped row.
    const xml=await documentXml(await buildCandidateProfileDocx(view()))
    const labels=textRuns(xml)
    const start=labels.indexOf('INFORMATION')
    expect(start).toBeGreaterThanOrEqual(0)
    const ordered=['Name','Photo','Age','Current Employment','Education','Nationality','Current Location','Current Salary','Other Benefits','Expected Salary','Notice Period','Languages','Motivation to move','Other Interview Process','First impression of company','First impression of job','Strengths & Opportunities','Risks & Challenge']
    let cursor=start
    for(const label of ordered){
      const found=labels.indexOf(label,cursor)
      expect(found,`information row "${label}" missing or out of order`).toBeGreaterThan(cursor-1)
      cursor=found
    }
  })

  it('marks the information header as a repeating table header row',async()=>{
    const xml=await documentXml(await buildCandidateProfileDocx(view()))
    expect([...xml.matchAll(/<w:tblHeader\b/g)]).toHaveLength(1)
  })

  it('prints "To be confirmed" for every field the consultant left blank',async()=>{
    const xml=await documentXml(await buildCandidateProfileDocx(view({details:emptyProfileDetails()})))
    // Ten fill-in rows are blank; the two AI rows carry text, so exactly ten placeholders appear.
    expect(textRuns(xml).filter((text)=>text==='To be confirmed')).toHaveLength(10)
  })

  it('folds education, strengths, risks and points to validate into the table and summary',async()=>{
    // They were standalone sections before. If any returns as a heading, the format has drifted.
    const xml=await documentXml(await buildCandidateProfileDocx(view()))
    expect([...xml.matchAll(/w:val="Heading1"/g)]).toHaveLength(2)
    const headings=textRuns(xml)
    expect(headings).toContain('CANDIDATE SUMMARY')
    expect(headings).toContain('WORK EXPERIENCE')
    expect(headings).not.toContain('EDUCATION')
    expect(headings).not.toContain('STRENGTHS AND OPPORTUNITIES')
    expect(headings).not.toContain('RISKS AND CHALLENGES')
    expect(headings).not.toContain('POINTS TO VALIDATE')
    // The points to validate survive as the closing summary bullet.
    expect(textRuns(xml).some((text)=>text.startsWith('Points to validate: '))).toBe(true)
  })

  it('centres the headings and keeps them at outline level zero',async()=>{
    const blob=await buildCandidateProfileDocx(view())
    expect(await partXml(blob,'word/styles.xml')).toContain('<w:outlineLvl w:val="0"/>')
    expect(await documentXml(blob)).toContain('<w:jc w:val="center"/>')
  })

  it('sets the candidate name in faux small caps',async()=>{
    // Each word's initial is two points larger than the rest, as the approved cover does it.
    const xml=await documentXml(await buildCandidateProfileDocx(view()))
    expect(xml).toContain('<w:sz w:val="40"/>')
    expect(textRuns(xml).join('')).toContain('FRANCO')
  })

  it('writes real list paragraphs rather than literal bullet characters',async()=>{
    const xml=await documentXml(await buildCandidateProfileDocx(view()))
    expect(xml).toContain('<w:numPr>')
    expect(textRuns(xml).some((text)=>text.startsWith('•'))).toBe(false)
  })

  it('links a company website when one is supplied and omits the line when not',async()=>{
    const withSite=await buildCandidateProfileDocx(view({websites:{[roleKey('Betterplace','Hotel Manager')]:'https://betterplace.cc/'}}))
    expect(await documentXml(withSite)).toContain('<w:hyperlink')
    expect(await partXml(withSite,'word/_rels/document.xml.rels')).toContain('betterplace.cc')
    expect(await documentXml(await buildCandidateProfileDocx(view()))).not.toContain('<w:hyperlink')
  })

  it('withholds identity but keeps the commercial terms when anonymized',async()=>{
    const anonymous=view({anonymized:true})
    const rows=Object.fromEntries(anonymous.information)
    expect(anonymous.candidateName).toBe('Confidential candidate')
    expect(rows['Current Location']).toBe('Withheld')
    expect(rows['Age']).toBe('Withheld')
    expect(rows['Nationality']).toBe('Withheld')
    // Salary is the substance the client is judging; withholding it leaves nothing to decide on.
    expect(rows['Current Salary']).toBe('To be confirmed')
    expect(JSON.stringify(anonymous)).not.toContain('Franco George Wenas')
    expect(JSON.stringify(anonymous)).not.toContain('Bali, Indonesia')
  })

  it('produces a non-empty document and a safe filename',async()=>{
    const approved=view();const docx=await buildCandidateProfileDocx(approved)
    expect(docx.size).toBeGreaterThan(1000)
    expect(profileFilename(approved,'docx')).toBe('Franco_George_Wenas_Operations_Manager_House_of_Kairos.docx')
    expect(profileFilename(view({anonymized:true}),'docx')).toBe('confidential-candidate_Operations_Manager_House_of_Kairos.docx')
    if(process.env.PROFILE_QA_OUTPUT){const output=resolve(process.env.PROFILE_QA_OUTPUT);await mkdir(output,{recursive:true});await writeFile(resolve(output,'candidate-profile.docx'),new Uint8Array(await docx.arrayBuffer()))}
  })

  it('translates the mandatory rows without changing their order',async()=>{
    const indonesian=view({language:'id'})
    expect(indonesian.information.map(([label])=>label)[2]).toBe('Pekerjaan saat ini')
    expect(indonesian.sectionLabels.summary).toBe('Ringkasan kandidat')
    expect(indonesian.information).toHaveLength(17)
  })
})

describe('evidence-backed candidate profile',()=>{
  it('calculates the internal score deterministically',()=>{expect(calculateEvidenceScore(draft.requirement_evidence)).toBe(50);expect(calculateEvidenceScore([{...draft.requirement_evidence[0]!,classification:'partial'}])).toBe(50)})
  it('rejects incomplete template section configurations',()=>{const invalid=defaultCandidateProfileTemplate();invalid.sections.pop();expect(candidateProfileTemplateConfigSchema.safeParse(invalid).success).toBe(false)})
  it('rejects inferred facts classified as evidence',()=>{const invalid={...draft,requirement_evidence:[{requirement:'P&L ownership',classification:'matched',source:'candidate_record',source_path:'',excerpt:'',explanation:'Likely responsible based on title.'}]};expect(candidateProfileDraftSchema.safeParse(invalid).success).toBe(false)})
  it('formats employment ranges in English and Indonesian',()=>{const role=candidate.employment[0]!;expect(formatEmploymentRange(role,'en')).toBe('November 2025 - Present');expect(formatEmploymentRange(role,'id')).toContain('November 2025')})
  it('matches relevance by company and title',()=>{expect(relevanceFor(draft,candidate.employment[0]!,0)).toEqual(['Runs property operations.'])})
  it('detects drafts whose source versions changed',()=>{expect(hasStaleProfileInputs({candidate_updated_at:'a',job_updated_at:'b',template_version:2},{candidateUpdatedAt:'a',jobUpdatedAt:'changed',templateVersion:2})).toBe(true);expect(hasStaleProfileInputs({candidate_updated_at:'a',job_updated_at:'b',template_version:2},{candidateUpdatedAt:'a',jobUpdatedAt:'b',templateVersion:2})).toBe(false)})

  /* The degraded draft the edge function serves when the provider refuses on billing has to satisfy
   * the same client-side schema a real draft does, or it would be rejected at the finalize boundary
   * and the outage would still block every document. */
  it('accepts the shape of a degraded draft and scores it zero',()=>{
    const degraded=candidateProfileDraftSchema.parse({candidate_summary:['To be confirmed.'],strengths_opportunities:'',risks_challenges:'',points_to_validate:[],experience_relevance:[{company_name:'Betterplace',title:'Hotel Manager',relevance:[]}],requirement_evidence:[{requirement:'Property operations',classification:'uncertain',source:'none',source_path:'',excerpt:'',explanation:'Not evaluated: the AI provider was unavailable for billing reasons.'}],score:0})
    expect(degraded.score).toBe(0)
    // Not calculateEvidenceScore: 'uncertain' weighs .25 and would present an unevaluated candidate as 25.
    expect(calculateEvidenceScore(degraded.requirement_evidence)).toBe(25)
  })
})
