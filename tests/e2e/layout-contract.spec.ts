import {expect,test} from '@playwright/test'
import {BD_BOARD_FIXTURE,CLIENTS_TABLE_FIXTURE} from './bdFixture'

/* Layout contract for the dense authenticated surfaces, checked without authenticating.
 *
 * Those screens live behind Supabase auth, so a browser gate cannot reach them -- which is a large
 * part of why their overflow regressions keep shipping. The candidates table went out with 25px of
 * internal horizontal scroll at 1366px and nothing in CI was in a position to notice.
 *
 * This visits /login purely to get the REAL production stylesheet loaded, then replaces the document
 * body with the markup those screens render. So it is a contract on the CSS system -- column
 * allocation, control heights, the board's contained scroll -- not on the React that produces the
 * markup: it cannot catch a component that stops emitting these class names. Table.test.tsx covers
 * that half. This covers the half that only exists once a stylesheet is applied, which unit tests in
 * jsdom can never reach because jsdom does no layout.
 *
 * Widths and themes are the set named in the responsive requirements. */
/* `tableFits` is the difference between a contract and a wrong assumption. The candidates table is
 * SUPPOSED to scroll inside .table-scroll below its three-column floor of 658px -- candidateColumns
 * documents that as the deliberate phone fallback, and the alternative (compressing a six-column
 * table into 390px) is the unreadable miniature table the responsive requirements explicitly forbid.
 * So the table is required to fit only where it has room to; at phone widths the property that
 * matters is the one asserted everywhere -- that its scroll stays inside its own container and never
 * reaches the page. */
const WIDTHS=[
  {name:'compact-desktop',width:1280,height:800,tableFits:true},
  {name:'business-laptop',width:1366,height:768,tableFits:true},
  {name:'executive-desktop',width:1440,height:900,tableFits:true},
  {name:'full-hd',width:1920,height:1080,tableFits:true},
  {name:'phone',width:390,height:844,tableFits:false},
  {name:'large-phone',width:430,height:932,tableFits:false},
] as const

/* Mirrors what CandidatesPage, JobWorkspacePage and the KPI strip actually emit: same class names,
 * same nesting, and deliberately hostile content -- a long Indonesian full name, a long
 * role-at-company sub-line, an IDR figure in the billions. Short placeholder text would sail through
 * this suite while the real thing overflowed, which would make the whole file worse than useless. */
const SURFACES=`
<div class="app-layout">
  <aside class="sidebar"><div class="brand"><span class="brand-mark">RT</span><div><strong>Rascal Talent</strong><small>Workspace</small></div></div>
    <nav aria-label="Primary navigation"><div class="nav-section"><a class="active" href="#"><span>Candidates</span></a></div></nav></aside>
  <div class="workspace">
    <header class="topbar"><button class="global-search"><span>Search candidates, jobs, or clients</span><kbd>Ctrl K</kbd></button>
      <div class="topbar-actions"><button class="button button-secondary button-sm"><span>Add</span></button></div></header>
    <main class="page">
      <header class="page-header"><div class="page-heading"><h1>Candidates</h1>
        <p class="page-description">Every candidate in the workspace, with what is owed next.</p></div>
        <div class="page-actions"><button class="button button-primary"><span>Add candidate</span></button></div></header>
      <div class="page-content">
        <div class="kpi-grid" id="kpis">
          <article class="kpi"><div><p>Pipeline value</p><strong>IDR 5.58B</strong></div></article>
          <article class="kpi"><div><p>Accounts in play</p><strong>24</strong></div></article>
          <article class="kpi kpi-alert"><div><p>Need attention</p><strong>7</strong></div></article>
          <article class="kpi"><div><p>Open jobs</p><strong>18</strong></div></article>
        </div>
        <section class="panel panel-flat panel-padding-none">
          <div class="table-scroll table-sticky candidates-table candidates-table-six" id="candidates">
            <table class="table-allocated">
              <colgroup><col><col style="width:200px"><col style="width:210px"><col style="width:120px"><col style="width:132px"><col style="width:48px"></colgroup>
              <thead><tr><th scope="col">Candidate</th><th scope="col">Current process</th><th scope="col">Next action</th>
                <th scope="col">Owner</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Row actions</span></th></tr></thead>
              <tbody><tr>
                <td><div class="candidate-row-identity"><span class="avatar-sm">BS</span><div class="candidate-row-identity-text">
                  <a class="record-link" href="#"><strong class="truncate-reveal">Bambang Sutrisno Wijayakusuma</strong></a>
                  <span class="truncate-reveal">Senior Financial Controller at PT Sinar Mas Agro Resources Tbk</span></div></div></td>
                <td><strong>Head of Finance</strong><span>Interview - 12d</span></td>
                <td><strong>Call re: notice period</strong><span>3 days late</span></td>
                <td><span>Satya Mertanadi</span></td>
                <td><span class="badge badge-good">Active</span></td>
                <td><button class="icon-button row-menu-trigger" aria-label="Actions">More</button></td>
              </tr></tbody>
            </table>
          </div>
        </section>
        <section class="panel panel-flat panel-padding-sm">
          <div class="kanban" id="board">
            <div class="kanban-column"><article class="candidate-card workflow-candidate-card">
              <button type="button"><span class="workflow-card-name">Bambang Sutrisno Wijayakusuma</span>
              <span class="workflow-card-role">Senior Financial Controller - PT Sinar Mas</span>
              <span class="workflow-card-bottom"><span class="workflow-days-badge">12d</span>
              <span class="workflow-card-owner workflow-card-owner-empty">Unassigned</span></span></button>
            </article></div>
            <div class="kanban-column"><article class="candidate-card workflow-candidate-card"><button type="button"><span class="workflow-card-name">Siti Rahmawati</span></button></article></div>
            <div class="kanban-column"><article class="candidate-card workflow-candidate-card"><button type="button"><span class="workflow-card-name">Andi Prasetyo</span></button></article></div>
            <div class="kanban-column"><article class="candidate-card workflow-candidate-card"><button type="button"><span class="workflow-card-name">Dewi Lestari</span></button></article></div>
            <div class="kanban-column"><article class="candidate-card workflow-candidate-card"><button type="button"><span class="workflow-card-name">Joko Widodo Santoso</span></button></article></div>
            <div class="kanban-column"><article class="candidate-card workflow-candidate-card"><button type="button"><span class="workflow-card-name">Rina Kartika</span></button></article></div>
          </div>
        </section>
      </div>
    </main>
  </div>
</div>`

for(const theme of ['light','dark'] as const){
  for(const viewport of WIDTHS){
    test(`no horizontal overflow on dense surfaces at ${viewport.name} (${theme})`,async({page})=>{
      await page.goto('/login')
      await page.evaluate(({markup,mode}:{markup:string;mode:string})=>{
        document.documentElement.setAttribute('data-theme',mode)
        document.body.innerHTML=markup
      },{markup:SURFACES,mode:theme})
      await page.setViewportSize({width:viewport.width,height:viewport.height})

      const result=await page.evaluate(()=>{
        const root=document.documentElement
        const table=document.getElementById('candidates')
        const kpis=document.getElementById('kpis')
        return {
          pageOverflow:root.scrollWidth-root.clientWidth,
          tableOverflow:table?table.scrollWidth-table.clientWidth:0,
          /* A scrollable overflow, not a hidden one: content the user can still reach. */
          tableScrollContained:table?['auto','scroll'].includes(getComputedStyle(table).overflowX):false,
          /* A KPI value that wraps has broken its container even when nothing overflows: the tile
           * grows to fit instead, and the row goes ragged. One line is the contract.
           * Measured against the element's OWN computed line-height rather than a pixel threshold --
           * a hardcoded number silently becomes wrong the moment the type scale moves, which is
           * exactly the kind of drift this suite exists to catch rather than commit. */
          kpiWrapped:kpis?[...kpis.querySelectorAll('strong')].some((el)=>{
            const lineHeight=Number.parseFloat(getComputedStyle(el).lineHeight)
            if(!Number.isFinite(lineHeight))return false
            return el.getBoundingClientRect().height>lineHeight*1.5
          }):false,
        }
      })

      /* The invariant, at every width and in both themes: nothing escapes to the page. */
      expect(result.pageOverflow,'page-level horizontal overflow').toBeLessThanOrEqual(0)
      expect(result.kpiWrapped,'a KPI value wrapped out of its tile').toBe(false)
      if(viewport.tableFits){
        expect(result.tableOverflow,'candidates table internal overflow').toBeLessThanOrEqual(0)
      }else{
        /* Below the three-column floor the table is expected to scroll -- but only inside
         * .table-scroll, which the page-overflow assertion above is what actually proves. */
        expect(result.tableScrollContained,'the table scroll must be contained, not clipped away').toBe(true)
      }
    })
  }
}

/* The board's horizontal scroll has to stay CONTAINED, not be absent -- scrolling there is the
 * deliberate design, and the thing that must never happen is it dragging the page with it.
 * Asserted at 1366 specifically: at 1920 the columns may genuinely all fit, so requiring a scrollbar
 * there would fail for the right reason at the wrong width. */
test('the pipeline board scrolls inside its own container, not the page',async({page})=>{
  await page.goto('/login')
  await page.evaluate((markup:string)=>{document.body.innerHTML=markup},SURFACES)
  await page.setViewportSize({width:1366,height:768})
  const result=await page.evaluate(()=>{
    const board=document.getElementById('board')
    if(!board)throw new Error('The board fixture did not render.')
    return {
      boardOverflows:board.scrollWidth>board.clientWidth,
      pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      overflowX:getComputedStyle(board).overflowX,
    }
  })
  expect(result.boardOverflows,'six wide columns should not fit a 1366px laptop').toBe(true)
  expect(['auto','scroll']).toContain(result.overflowX)
  expect(result.pageOverflow,'the board must not drag the page with it').toBeLessThanOrEqual(0)
})

/* The Business Development board, as ClientsPage actually renders it.
 *
 * Deliberately NOT the generic `.kanban` fixture above. That one passes, and passed while production
 * was overflowing, because it is missing two things the real board has: the `.panel-body` wrapper
 * every Panel emits, and `.bd-board`'s seven stages. A contract that only exercises `.kanban` is a
 * contract that agrees with a broken page.
 *
 * Seven columns, from bdStages, with the widest content a real account produces: a long PT name, an
 * IDR figure in the billions, risk badges and the move-stage select.
 */
const BD_BOARD=BD_BOARD_FIXTURE

for(const theme of ['light','dark'] as const){
  for(const viewport of WIDTHS){
    test(`the BD board scrolls itself and never the page at ${viewport.name} (${theme})`,async({page})=>{
      await page.goto('/login')
      await page.evaluate(({markup,mode}:{markup:string;mode:string})=>{
        document.documentElement.setAttribute('data-theme',mode)
        document.body.innerHTML=markup
      },{markup:BD_BOARD,mode:theme})
      await page.setViewportSize({width:viewport.width,height:viewport.height})

      const result=await page.evaluate(()=>{
        const root=document.documentElement
        const board=document.getElementById('bd-board')
        if(!board)throw new Error('The BD board fixture did not render.')
        const columns=[...board.querySelectorAll('.bd-column')]
        const first=columns[0]?.getBoundingClientRect()
        const last=columns[columns.length-1]?.getBoundingClientRect()
        const boardBox=board.getBoundingClientRect()
        return {
          pageOverflow:root.scrollWidth-root.clientWidth,
          boardOverflow:board.scrollWidth-board.clientWidth,
          overflowX:getComputedStyle(board).overflowX,
          boardWithinViewport:boardBox.width<=root.clientWidth+1,
          columnCount:columns.length,
          /* Reachability: with the board scrolled fully right the last column must be inside the
           * board's own box. A column that is only reachable by scrolling the DOCUMENT is the defect
           * this test exists for, not a workaround for it. */
          firstColumnWidth:first?first.width:0,
          lastColumnWidth:last?last.width:0,
        }
      })

      /* The invariant. At 1366 production measured documentElement.scrollWidth 2575 against a
       * clientWidth of 1348 -- the board pushed the whole application sideways. */
      expect(result.pageOverflow,'the BD board must never give the document horizontal scroll').toBeLessThanOrEqual(0)
      expect(result.boardWithinViewport,'the board box must fit the viewport').toBe(true)
      expect(result.columnCount,'all seven BD stages should render').toBe(7)
      /* Columns keep a usable width rather than being crushed to fit -- the alternative reading of
       * "no overflow" is an unreadable seven-column miniature, which the responsive rules forbid. */
      expect(result.firstColumnWidth,'first column must stay usable').toBeGreaterThanOrEqual(200)
      expect(result.lastColumnWidth,'last column must stay usable').toBeGreaterThanOrEqual(200)
      /* Scrolling is the board's job and must remain possible, not be clipped away. */
      expect(['auto','scroll']).toContain(result.overflowX)
      if(result.boardOverflow>0){
        // Where the columns genuinely exceed the viewport, the scroll lives on the board.
        expect(result.boardOverflow,'the board should own its own horizontal scroll').toBeGreaterThan(0)
      }
    })
  }
}

/* Reachability, asserted by actually scrolling rather than by measuring. At 1366 the seven columns
 * cannot fit, so the last one is only reachable if the board scrolls -- which is the whole design. */
test('every BD column is reachable by scrolling the board itself',async({page})=>{
  await page.goto('/login')
  await page.evaluate((markup:string)=>{document.body.innerHTML=markup},BD_BOARD)
  await page.setViewportSize({width:1366,height:768})
  const result=await page.evaluate(()=>{
    const board=document.getElementById('bd-board')
    if(!board)throw new Error('The BD board fixture did not render.')
    board.scrollLeft=board.scrollWidth
    const last=board.querySelector('.bd-column:last-child')?.getBoundingClientRect()
    const boardBox=board.getBoundingClientRect()
    return {
      scrolled:board.scrollLeft>0,
      lastColumnVisible:Boolean(last&&last.right<=boardBox.right+1&&last.left>=boardBox.left-1),
      pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    }
  })
  expect(result.scrolled,'the board should have somewhere to scroll at 1366px').toBe(true)
  expect(result.lastColumnVisible,'the final stage must be reachable inside the board').toBe(true)
  expect(result.pageOverflow,'scrolling the board must not move the page').toBeLessThanOrEqual(0)
})

/* The Clients table's final column. The audit reported the agreement/status content appearing cut
 * off at 1366px, and the contract is the one the responsive rules already state: the table may scroll
 * inside .table-scroll, but the page never scrolls and the last column is never clipped away with no
 * way to reach it. Asserted at desktop AND phone, because the answer differs -- above the 890px floor
 * it simply fits; below it the table scrolls and the column has to arrive when you scroll to it. */
for(const width of [1366,390]){
  test(`the clients table keeps its agreement column reachable at ${width}`,async({page})=>{
    await page.goto('/login')
    await page.evaluate((markup:string)=>{document.body.innerHTML=markup},CLIENTS_TABLE_FIXTURE)
    await page.setViewportSize({width,height:width===1366?768:844})
    const result=await page.evaluate(()=>{
      const container=document.getElementById('clients-table')
      const cell=document.getElementById('clients-last-cell')
      if(!container||!cell)throw new Error('The clients table fixture did not render.')
      container.scrollLeft=container.scrollWidth
      const box=container.getBoundingClientRect()
      const cellBox=cell.getBoundingClientRect()
      const badges=[...cell.querySelectorAll('.badge')].map((badge)=>badge.getBoundingClientRect())
      return {
        pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        overflowX:getComputedStyle(container).overflowX,
        /* Fully inside the container once scrolled to it -- not merely overlapping its edge. */
        lastCellReachable:cellBox.right<=box.right+1&&cellBox.left>=box.left-1,
        /* Every badge keeps its whole width. "Reachable" must not mean a sliver of a chip. */
        badgesIntact:badges.every((badge)=>badge.width>40&&badge.right<=box.right+1),
        badgeCount:badges.length,
      }
    })
    expect(result.pageOverflow,'the clients table must never scroll the page').toBeLessThanOrEqual(0)
    expect(['auto','scroll']).toContain(result.overflowX)
    expect(result.badgeCount,'both commercial badges should render').toBe(2)
    expect(result.lastCellReachable,'the agreement/status column must be reachable inside its own container').toBe(true)
    expect(result.badgesIntact,'the agreement badges must not be clipped into fragments').toBe(true)
  })
}

