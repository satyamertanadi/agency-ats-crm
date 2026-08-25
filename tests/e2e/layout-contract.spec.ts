import {expect,test} from '@playwright/test'

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
