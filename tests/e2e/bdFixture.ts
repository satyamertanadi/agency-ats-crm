/* The Business Development board fixture, shared by the layout contract and any diagnosis of it.
 * Exported from one module so a measurement and an assertion can never drift onto different markup. */
export const BD_BOARD_FIXTURE=`
<div class="app-layout">
  <aside class="sidebar"><div class="brand"><span class="brand-mark">RT</span><div><strong>Rascal Talent</strong><small>Workspace</small></div></div>
    <nav aria-label="Primary navigation"><div class="nav-section"><a class="active" href="#"><span>Clients</span></a></div></nav></aside>
  <div class="workspace">
    <header class="topbar"><button class="global-search"><span>Search candidates, jobs, or clients</span><kbd>Ctrl K</kbd></button></header>
    <main class="page">
      <header class="page-header"><div class="page-heading"><h1>Clients</h1></div></header>
      <div class="page-content">
        <section class="panel panel-flat panel-default panel-comfortable panel-padding-sm" id="bd-panel">
          <div class="panel-body">
            <div class="kanban bd-board" id="bd-board">
              ${['Lead','Qualifying','Pitching','Negotiating','Won','Lost','Dormant'].map((label,index)=>`
              <section class="kanban-column bd-column">
                <header><strong>${label}</strong><span>${index+2}</span></header>
                <p class="bd-column-meta">${index+1} open jobs · IDR 1.24B</p>
                <article class="candidate-card bd-card">
                  <a class="bd-card-open" href="#"><strong>PT Sinar Mas Agro Resources and Technology Tbk</strong><span>Satya Mertanadi</span></a>
                  <p class="bd-card-stats"><span>4</span><span>12 Aug 2026</span><span class="bd-card-value">IDR 1,240,000,000</span></p>
                  <p class="bd-card-risks"><span class="badge badge-bad">No agreement</span><span class="badge badge-warning">Follow-up overdue</span></p>
                  <label><span class="sr-only">Move to another stage</span>
                    <select aria-label="Move account"><option>Negotiating</option></select></label>
                </article>
              </section>`).join('')}
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</div>`

/* The Clients list as ClientsPage renders it: five allocated columns behind an 890px floor, with the
 * final cell carrying the two badges that gate commercial work. That last column is the one the
 * audit flagged as cut off at 1366px, so the fixture has to reproduce its real width and content --
 * a short placeholder would fit anywhere and prove nothing. */
export const CLIENTS_TABLE_FIXTURE=`<div class="app-layout"><aside class="sidebar"></aside><div class="workspace"><main class="page"><div class="page-content"><section class="panel panel-flat panel-default panel-comfortable panel-padding-none"><div class="panel-body"><div class="table-scroll table-sticky clients-table" id="clients-table"><table class="table-allocated"><colgroup><col><col style="width:190px"><col style="width:160px"><col style="width:170px"><col style="width:180px"></colgroup><thead><tr><th scope="col">Client</th><th scope="col">BD stage / owner</th><th scope="col">Open jobs / value</th><th scope="col">Next action</th><th scope="col" id="clients-last-header">Agreement / status</th></tr></thead><tbody><tr><td><a class="record-link" href="#"><strong>PT Sinar Mas Agro Resources and Technology Tbk</strong></a><span>Agriculture and plantations</span></td><td><strong>Negotiating</strong><span class="cell-sub">Satya Mertanadi</span></td><td class="money"><strong>4</strong><span>IDR 1.24B</span></td><td><div class="cell-lead"><strong class="cell-strong overdue-text">12 Aug 2026</strong></div><span class="cell-sub">3 days late</span></td><td id="clients-last-cell"><span class="chip-row"><span class="badge badge-bad">Agreement expired</span><span class="badge badge-good">Active client</span></span></td></tr></tbody></table></div></div></section></div></main></div></div>`

/* The candidates rail carrying both menu triggers at their post-rename widths. "Saved view:" and
   "Talent list:" are longer than the "View:" and "List:" they replace, and the rail wraps rather
   than scrolling, so the question is whether they still fit a phone without pushing the page. */
export const TOOLBAR_FIXTURE=`<div class="app-layout"><aside class="sidebar"></aside><div class="workspace"><main class="page"><div class="page-content"><section class="panel panel-flat panel-padding-none"><div class="panel-body"><div class="toolbar" id="toolbar"><button class="button button-secondary button-sm view-menu" id="view-trigger"><span class="view-menu-label">Saved view:</span> All candidates</button><button class="button button-secondary button-sm view-menu" id="list-trigger"><span class="view-menu-label">Talent list:</span> Acme CFO shortlist</button><div class="search-box"><input class="input" placeholder="Name, company, or position"/></div><span class="toolbar-count">128 candidates</span></div></div></section></div></main></div></div>`
