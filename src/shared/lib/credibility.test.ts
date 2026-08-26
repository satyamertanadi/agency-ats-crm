import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {nameConcern,nameConcernHint} from './credibility'

/* The half of this that matters is the NEGATIVE half.
 *
 * Catching "Ilham is a seasoned finance professional with over 12 years" is easy. Not catching
 * "Maria del Carmen Fernandez de la Vega Sanz" is the hard part, and it is the part that decides
 * whether a consultant trusts the field or learns to work around it. Every real name below is one a
 * naive rule gets wrong: nobiliary particles, no surname at all, hyphenation, apostrophes,
 * non-Latin scripts, and a genuinely long Indonesian name.
 */
describe('names that must never be flagged',()=>{
  const realNames=[
    'Ni Putu Widya',
    'Bambang Sutrisno Wijayakusuma',
    // No surname. Extremely common in Indonesia and the case a "needs at least two words" rule breaks.
    'Suharto',
    'Maria del Carmen Fernandez de la Vega Sanz',
    'Ludwig van Beethoven',
    'Vincent van der Berg',
    'Jean-Luc Picard',
    "Siobhán O'Sullivan",
    'Muhammad bin Abdullah Al-Rashid',
    'Siti binti Ahmad',
    'José María Aznar López',
    '李秀英',
    'Владимир Иванов',
    'Ahmad Zulkifli bin Mohd Yusof Al-Hakim',
    'Dr. Rangga Perkasa',
    'Nguyễn Thị Minh Khai',
  ]
  for(const name of realNames){
    it(`accepts ${name}`,()=>{
      expect(nameConcern(name),`${name} was flagged`).toBeNull()
    })
  }

  // Nothing typed yet is not a concern; an empty field has its own required-ness elsewhere.
  it('says nothing about an empty value',()=>{
    expect(nameConcern('')).toBeNull()
    expect(nameConcern(null)).toBeNull()
    expect(nameConcern(undefined)).toBeNull()
    expect(nameConcern('   ')).toBeNull()
  })
})

describe('values that are not names',()=>{
  /* The production record, near enough. A scraped profile summary pasted into the name field. */
  it('flags a scraped sentence',()=>{
    expect(nameConcern('Ilham is a seasoned finance professional with over 12 years of experience'))
      .not.toBeNull()
  })

  it('flags digits',()=>{
    expect(nameConcern('Candidate 004')).toBe('digits')
  })

  it('flags an email address',()=>{
    expect(nameConcern('ilham.pratama@example.com')).toBe('email')
  })

  it('flags a URL',()=>{
    expect(nameConcern('https://linkedin.com/in/ilham')).toBe('url')
    expect(nameConcern('www.linkedin.com/in/ilham')).toBe('url')
  })

  it('flags something far longer than a name',()=>{
    expect(nameConcern('A'.repeat(101))).toBe('too_long')
  })

  it('flags more words than a name has',()=>{
    expect(nameConcern('One Two Three Four Five Six Seven Eight Nine Ten')).toBe('too_many_words')
  })

  it('flags lowercase function words that make it prose',()=>{
    expect(nameConcern('Andi and the finance team')).toBe('reads_as_prose')
    expect(nameConcern('Rina has moved to Jakarta')).toBe('reads_as_prose')
  })

  /* The particles are the trap: `de`, `van`, `bin` are function-word-shaped and belong in names, so
   * they must not be in the prose list. Pinned separately from the accept cases above because this
   * is the specific way this rule would be broken by someone extending it. */
  it('does not treat nobiliary particles as prose',()=>{
    for(const particle of ['van','der','den','de','del','la','le','bin','binti','al','ibn','dos','da']){
      expect(nameConcern(`Ana ${particle} Silva`),`${particle} was treated as prose`).toBeNull()
    }
  })
})

describe('the hint',()=>{
  it('offers nothing for a real name',()=>{
    expect(nameConcernHint('Ni Putu Widya')).toBeNull()
  })

  /* Tone is load-bearing. This is a question put to the person who knows the answer, not a refusal,
   * and copy that reads as a refusal is how a field gets worked around. */
  it('asks rather than refuses',()=>{
    const hint=nameConcernHint('Candidate 004')||''
    expect(hint).toMatch(/check/i)
    expect(hint).not.toMatch(/invalid|not allowed|must|error|cannot/i)
  })
})

/* The audit that runs against a live client database. Its one absolute property is that it cannot
 * change anything -- it is meant to be run by someone who has not read it, and remediation is a
 * separate reviewed step with an export taken first. */
describe('the credibility audit script',()=>{
  const sql=readFileSync(resolve(process.cwd(),'scripts/credibility-audit.sql'),'utf8')
  const executable=sql.split('\n')
    .filter((line)=>!line.trim().startsWith('--'))
    .join('\n')

  it('contains no statement that writes',()=>{
    for(const verb of ['insert into','update ','delete from','drop ','alter ','truncate','grant ','revoke ','create ']){
      expect(executable.toLowerCase().includes(verb),`the audit must not ${verb.trim()}`).toBe(false)
    }
  })

  /* Every finding CTE has to be organisation-scoped. On the dedicated-instance deployment there is
   * normally one workspace per database, so a missing join would look harmless right up until it did
   * not -- and an audit that silently reports another tenant's records is worse than none. */
  it('scopes every finding to an organisation',()=>{
    const findingCtes=[...executable.matchAll(/^(\w+) as \(/gm)].map((match)=>match[1])
      .filter((name)=>name!=='scope')
    expect(findingCtes.length).toBeGreaterThanOrEqual(10)
    const scopeJoins=[...executable.matchAll(/join scope on scope\.organization_id/g)].length
    expect(scopeJoins,'every finding CTE must join scope').toBeGreaterThanOrEqual(findingCtes.length)
  })

  /* Each of the nine categories the audit is required to report. Named here so removing one is a
   * deliberate edit to a test rather than a quiet gap in a report somebody trusts. */
  it('reports every category it claims to',()=>{
    for(const check of ['sentence_like_name','test_identity','compensation_outlier','compensation_impossible',
      'fee_impossible','unassigned_overdue_task','unassigned_open_job','contradictory_client_state',
      'missing_commercial_terms','nonsense_activity']){
      expect(sql,`${check} is missing from the audit`).toContain(check)
    }
  })
})
