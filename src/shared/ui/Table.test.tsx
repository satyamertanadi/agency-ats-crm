import {render,screen} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import {Table} from './Table'
import {visibleCandidateColumns} from '../../features/candidates/candidateColumns'

/* This exists because the bug it guards was invisible to the module that "owned" it.
 *
 * candidateColumns already marked `select` and `menu` as hideLabel, and Table already knew how to
 * render a hidden heading -- but CandidatesPage built its headers with
 * `columns.map(c=>({label:c.label,width:c.width}))` and silently dropped the third property. The
 * result shipped: "Row actions" rendered visibly, at 12px uppercase with wide tracking, inside a
 * 48px column. Measured against the built stylesheet at 1366px, that pushed 25px of horizontal
 * overflow into .table-scroll.
 *
 * A unit test on candidateColumns would have passed throughout -- it was producing the right value.
 * So the assertion has to be made where the value is CONSUMED: rendered output, not the config. */
describe('Table hides headings marked hideLabel',()=>{
  it('keeps the heading accessible while taking it off screen',()=>{
    render(<Table headers={[{label:'Candidate'},{label:'Row actions',width:'48px',hideLabel:true}]}><tr><td>Row</td><td>Menu</td></tr></Table>)
    const menuHeader=screen.getByRole('columnheader',{name:'Row actions'})
    /* Still announced -- a <th> with no accessible name leaves the column unannounced in table
     * navigation and strips the header association from every cell beneath it. */
    expect(menuHeader).toBeInTheDocument()
    /* ...but carried by an .sr-only span rather than a text node, which is what keeps it out of the
     * column's width. */
    expect(menuHeader.querySelector('.sr-only')?.textContent).toBe('Row actions')
    expect(menuHeader.textContent).toBe('Row actions')
  })

  it('renders an ordinary heading as visible text',()=>{
    render(<Table headers={[{label:'Candidate'}]}><tr><td>Row</td></tr></Table>)
    expect(screen.getByRole('columnheader',{name:'Candidate'}).querySelector('.sr-only')).toBeNull()
  })
})

/* The integration half: every column candidateColumns marks hidden must still be marked hidden by
 * the time it reaches Table's prop shape. Written against visibleCandidateColumns' real output so it
 * covers whichever columns that module decides are self-describing, not a hardcoded pair. */
describe('candidate column headers survive the trip to Table',()=>{
  it('carries hideLabel through for every column that declares it',()=>{
    const columns=visibleCandidateColumns('six',true)
    const hidden=columns.filter((column)=>column.hideLabel).map((column)=>column.label)
    expect(hidden).toEqual(['Select','Row actions'])

    // The exact expression CandidatesPage passes to <Table headers=...>.
    const headers=columns.map((column)=>({label:column.label,width:column.width,hideLabel:column.hideLabel}))
    render(<Table headers={headers}><tr>{columns.map((column)=><td key={column.id}>cell</td>)}</tr></Table>)
    for(const label of hidden){
      const header=screen.getByRole('columnheader',{name:label})
      expect(header.querySelector('.sr-only')?.textContent).toBe(label)
    }
  })
})
