import { describe,expect,it } from 'vitest'
import { parseCandidateCsv } from './candidateCsv'
describe('candidate CSV parsing',()=>{it('maps common recruiter headers',()=>{const row=parseCandidateCsv('Name,Email,Company,Position\nAda Lovelace,ada@example.com,Analytical Engines,Engineer')[0]!;expect(row.errors).toEqual([]);expect(row.data).toMatchObject({full_name:'Ada Lovelace',current_company:'Analytical Engines'})});it('reports failed rows',()=>{const row=parseCandidateCsv('full_name,email\nA,not-an-email')[0]!;expect(row.errors.length).toBeGreaterThan(0)})})
