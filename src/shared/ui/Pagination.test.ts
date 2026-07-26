import {describe,expect,it} from 'vitest'
import {pageWindow} from './Pagination'

/* Only the windowing arithmetic is worth asserting directly -- rendering it would test React more than
 * the maths. The contract: first and last page always offered, a window around the current page, gaps
 * elided, and never an ellipsis standing in for a single number. */
describe('pageWindow',()=>{
  it('lists every page when they all fit',()=>{
    expect(pageWindow(0,3)).toEqual([0,1,2])
  })

  it('elides the middle when the current page is near the start',()=>{
    expect(pageWindow(0,30)).toEqual([0,1,'gap',29])
  })

  it('windows around the current page and elides both sides',()=>{
    expect(pageWindow(15,30)).toEqual([0,'gap',14,15,16,'gap',29])
  })

  it('elides the middle when the current page is near the end',()=>{
    expect(pageWindow(29,30)).toEqual([0,'gap',28,29])
  })

  it('renders a single skipped page as itself rather than an ellipsis',()=>{
    // Pages 0..3 with the window on 2 leaves only page 1 between 0 and the window -- an "…" there
    // would be wider than the number it hides.
    expect(pageWindow(2,4)).toEqual([0,1,2,3])
  })

  it('renders nothing to window when there is one page',()=>{
    expect(pageWindow(0,1)).toEqual([0])
  })
})
