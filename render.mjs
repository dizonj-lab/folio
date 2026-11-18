// Render the portfolio from portfolio.json: the index, plus one page per sub-project.
//   node render.mjs <work dir> <stage dir> "<built slugs>" <likec4 version>
// Projects are a carousel of same-height cards (summary, stack, buttons); the centred card's full description,
// highlights, sub-projects and feedback icons show in a details panel below. `logoTile: true` sets a logo on a light tile, for
// marks drawn in dark ink that would vanish on the dark theme. A sub-project's page content lives in
// its own JSON file (see pages/) and is written to /work/<project>/<sub-project>/. Everything is
// escaped: the JSON is content, not HTML.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [work, stage, builtArg = '', version = ''] = process.argv.slice(2)
const { site = {}, profile = {}, projects = [] } = JSON.parse(readFileSync(join(work, 'portfolio.json'), 'utf8'))
const built = new Set(builtArg.split(/\s+/).filter(Boolean))

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const external = href => /^https?:\/\//.test(href)
const link = ({ label, href }, cls = '') =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}"${external(href) ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}</a>`
const initials = name => esc(name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())
const subHref = (p, s) => `/work/${p.slug}/${s.slug}/`
// A project with its own write-up (`page`) that belongs to another (`parent`) keeps the parent's URL: /work/<parent>/<page>/.
const ownerOf = p => (p.parent && projects.find(x => x.slug === p.parent)) || p
const pageHref = p => p.page ? subHref(ownerOf(p), p.page) : ''
// Asset URLs carry a build stamp, so browsers and Cloudflare fetch the new CSS and JS after every
// rebuild instead of serving a cached copy.
const BUILD = Date.now().toString(36)
const fill = (template, values) => readFileSync(join(work, template), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m)
  .replace(/(href|src)="(\/(?:site\.css|feedback\.css|feedback\.js|charts\.js|carousel\.js))"/g, `$1="$2?v=${BUILD}"`)

const mark = p => p.logo
  ? `<img class="mark${p.logoTile ? ' mark-tile' : ''}" src="/${esc(p.logo)}" alt="" width="56" height="56">`
  : `<span class="mark mark-text" aria-hidden="true">${initials(p.name)}</span>`

// The stored choice is applied before first paint so a dark-mode visitor never sees a white flash.
// Storage can be unavailable (private windows, blocked site data); the page then follows the system.
// Colour themes (site.css :root[data-palette]); '' is the default teal. A visitor's choice lasts for the page only.
const PALETTES = [["", "Teal", "#0f766e"], ["indigo", "Slate & indigo", "#4338ca"], ["blue", "Graphite & blue", "#2563eb"], ["forest", "Stone & forest", "#2f6b4f"], ["mono", "Ink & white", "#111111"], ["burgundy", "Grey & burgundy", "#9f1239"], ["amber", "Sand & amber", "#a15c07"], ["plum", "Mist & plum", "#86198f"]]
const THEME_SCRIPT = `<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}
document.documentElement.classList.add('js');
function setPalette(k){var r=document.documentElement;if(k)r.dataset.palette=k;else delete r.dataset.palette;document.querySelectorAll('[data-pal]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.pal===k?'true':'false')})}
document.addEventListener('DOMContentLoaded',function(){var k=document.documentElement.dataset.palette||'';document.querySelectorAll('[data-pal]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.pal===k?'true':'false')})});
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-pal]');if(b){setPalette(b.dataset.pal);return}document.querySelectorAll('.theme-menu[open]').forEach(function(m){if(!m.contains(e.target))m.open=false})});
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.theme-menu[open]').forEach(function(m){m.open=false;m.querySelector('summary').focus()})});
function toggleTheme(){var r=document.documentElement,d=r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),n=d==='dark'?'light':'dark';r.dataset.theme=n;try{localStorage.setItem('theme',n)}catch(e){}}</script>`
const THEME_BUTTON = `<details class="theme-menu">
          <summary aria-label="Colour theme"><i aria-hidden="true"></i>Theme</summary>
          <div class="menu-pop" role="group" aria-label="Colour theme">
            <span class="mlabel">Colours</span>
            ${PALETTES.map(([k, n, c]) => `<button type="button" data-pal="${k}" aria-pressed="false"><i style="background:${c}" aria-hidden="true"></i>${n}</button>`).join('')}
            <hr>
            <button type="button" onclick="toggleTheme()"><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>Light / dark</button>
          </div>
        </details>`

const common = {
  NAME: esc(profile.name),
  SHORT_NAME: esc(profile.shortName ?? profile.name),
  THEME_SCRIPT,
  THEME_BUTTON,
  // Top bar: the full name with the roles under it, and the profile links (LinkedIn) in the menu.
  WHO: `<a class="who" href="/"><span class="wordmark">${esc(profile.name)}</span><span class="roles">${(profile.roles ?? [profile.role]).map(x => `<span>${esc(x)}</span>`).join('')}</span></a>`,
  NAV_LINKS: (profile.links ?? []).map(l => `<a href="${esc(l.href)}"${external(l.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}${external(l.href) ? ' <span aria-hidden="true">↗</span>' : ''}</a>`).join(''),
  YEAR: String(new Date().getUTCFullYear()),
  STAMP: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  VERSION: esc(version),
}

// A project's demo video is published only when its file was supplied to this build (setup.sh copies
// the newest one into media/); without it the card has no demo icon.
const hasDemo = p => p.demo && existsSync(join(work, p.demo.video))
const demoHref = p => `/demo/${p.slug}/`
// Photo credits that came with the video (a Markdown list: "- **dish**: [file](url), by …, licence").
const creditsHtml = p => {
  const file = p.demo.credits && join(work, p.demo.credits)
  if (!file || !existsSync(file)) return ''
  const items = readFileSync(file, 'utf8').split('\n').filter(l => l.startsWith('- ')).map(l => esc(l.slice(2))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[(.+?)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/\((https:\/\/[^)\s]+)\)/g, '(<a href="$1" rel="noopener">licence</a>)'))
  return items.length ? `<details class="note"><summary>Photo credits</summary><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></details>` : ''
}

// The demo the feedback row's play icon opens: the published demo page, else the project's demoUrl.
const demoLink = p => hasDemo(p) ? demoHref(p) : (p.demoUrl || '')

// The card's summary: the description's first sentence.
const summary = s => { const m = String(s ?? '').match(/^.+?[.!?](?=\s|$)/); return m ? m[0] : String(s ?? '') }
const card = (p, i, all) => {
  const acts = [...(p.page ? [link({ label: 'Read case study', href: pageHref(p) }, 'btn primary')] : []),
    ...(p.links ?? []).map(l => link(l, 'btn primary')),
    ...(demoLink(p) ? [link({ label: 'Watch demo', href: demoLink(p) }, 'btn')] : []),
    ...(p.learnMore ? [link({ label: 'Learn more', href: p.learnMore }, 'btn')] : [])]
  return `
      <article class="slide" id="${esc(p.slug)}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${all.length}: ${esc(p.name)}" data-i="${i}">
        <div class="project">
          <header>
            ${mark(p)}
            <div>
              <h3>${esc(p.name)}</h3>
              <p class="tagline">${esc(p.tagline)}</p>
            </div>
            ${p.status ? `<span class="status">${esc(p.status)}</span>` : ''}
          </header>
          <p class="desc">${esc(summary(p.description))}</p>
          ${p.stack?.length ? `<ul class="stack">${p.stack.slice(0, 4).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          <nav class="acts">${acts.join('')}</nav>
        </div>
      </article>`
}
const detail = (p, i) => {
  const subs = p.subprojects ?? []
  // A product lists the case studies that belong to it; each opens its own card in the carousel.
  const related = projects.filter(x => x.parent === p.slug)
  const fbApp = p.parent || p.slug, info = p.learnMore || pageHref(p)
  return `
        <div class="detail" data-i="${i}" id="detail-${esc(p.slug)}">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          ${p.highlights?.length ? `<ul class="highlights">${p.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          ${p.stack?.length ? `<ul class="stack">${p.stack.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${subs.length ? `<div class="subprojects"><h4>Sub-projects</h4>${subs.map(s => `<a class="subproject" href="${subHref(p, s)}"><div><strong>${esc(s.title)}</strong><span>${esc(s.summary)}</span></div><span class="arrow" aria-hidden="true">→</span></a>`).join('')}</div>` : ''}
          ${related.length ? `<div class="subprojects"><h4>Case studies</h4>${related.map(x => `<a class="subproject" href="#${esc(x.slug)}"><div><strong>${esc(x.name)}</strong><span>${esc(x.tagline)}</span></div><span class="arrow" aria-hidden="true">→</span></a>`).join('')}</div>` : ''}
          <div class="detail-foot">
            ${p.context ? `<span class="context">${esc(p.context)}</span>` : '<span></span>'}
            <div class="fb" data-app="${esc(fbApp)}" data-name="${esc(p.name)}"${info ? ` data-info="${esc(info)}"` : ''}${demoLink(p) ? ` data-demo="${esc(demoLink(p))}"` : ''}></div>
          </div>
        </div>`
}

// Content blocks a sub-project page can use. Numbers in tables keep their own formatting.
const table = b => `<div class="table"><table>${b.head ? `<thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${b.rows.map(r => `<tr>${r.map((c, i) => `<td${i && /^[\d,.–\- %+GB]+$/.test(c) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const blocks = {
  text: b => b.paragraphs.map(p => `<p>${esc(p)}</p>`).join(''),
  subheading: b => `<h3>${esc(b.text)}</h3>`,
  list: b => `<${b.ordered ? 'ol' : 'ul'}>${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`,
  table,
  flow: b => `<ol class="flow">${b.steps.map(s => `<li${s === b.highlight ? ' class="key"' : ''}>${esc(s)}</li>`).join('')}</ol>`,
  note: b => `<p class="note">${b.label ? `<strong>${esc(b.label)}</strong> ` : ''}${esc(b.text)}</p>`,
}
// Charts: a block names a dataset in the page's charts file and the fields to plot. The spec goes to
// charts.js, which draws it; the same rows are always written out as a table, so nothing depends on
// JavaScript or on hovering.
const fmts = { pct: v => (v * 100).toFixed(1) + '%', num: v => Math.round(v).toLocaleString('en'), dec: v => v.toFixed(2) }
const pick = (row, key) => key.includes('{') ? key.replace(/\{(\w+)\}/g, (_, k) => row[k]) : row[key]
// Matrix, scatter and curve charts take a dataset object rather than rows; their data table comes
// from the matrix itself or from a companion dataset (`tableData`).
const shaped = (b, data) => {
  const d = data[b.data]
  if (!d) throw new Error(`chart "${b.title}": no dataset "${b.data}" in the charts file`)
  const f = b.format ?? 'pct'
  let spec, legend = [], head, rows
  if (b.kind === 'heatmap') {
    spec = { kind: 'heatmap', title: b.title, labels: d.labels, matrix: d.matrix, counts: d.counts, format: f,
      domain: b.domain, scale: b.scale, labelMin: b.labelMin, rowTitle: b.rowTitle, colTitle: b.colTitle, legendNote: b.legendNote }
    head = ['', ...d.labels]
    rows = d.labels.map((l, i) => [l, ...d.matrix[i].map(v => fmts[f](v))])
  } else if (b.kind === 'scatter') {
    spec = { kind: 'scatter', title: b.title, points: d.points, groups: d.groups, xTitle: b.xTitle }
    legend = d.groups.map((g, i) => [i === d.groups.length - 1 ? 'other' : `c${i + 1}`, g])
  } else {
    spec = { kind: 'xy', title: b.title, series: d.series, xTitle: b.xTitle, yTitle: b.yTitle, diagonal: b.diagonal }
    legend = d.series.map((s, i) => [`s${i + 1}`, s.label])
  }
  if (b.tableData) {
    const t = data[b.tableData]
    head = b.table.map(c => c.label)
    rows = t.map(r => b.table.map(c => c.format ? fmts[c.format](r[c.field]) : String(r[c.field])))
  }
  return `<figure class="chart">
          <figcaption><strong>${esc(b.title)}</strong>${b.caption ? `<span>${esc(b.caption)}</span>` : ''}</figcaption>
          ${legend.length ? `<div class="legend">${legend.map(([c, l]) => `<span><i class="${c}"></i>${esc(l)}</span>`).join('')}</div>` : ''}<div class="plot" data-chart="${esc(JSON.stringify(spec))}"></div>
          ${rows ? `<details><summary>Data table</summary>${table({ head, rows })}</details>` : ''}
        </figure>`
}
const chart = (b, data) => {
  if (['heatmap', 'scatter', 'xy'].includes(b.kind)) return shaped(b, data)
  const rows = data[b.data]
  if (!rows) throw new Error(`chart "${b.title}": no dataset "${b.data}" in the charts file`)
  const f = b.format ?? 'num'
  const series = (b.series ?? []).map((sr, i) => ({ label: sr.label, color: sr.color ?? i + 1, values: rows.map(r => r[sr.field]) }))
  const spec = b.kind === 'reliability'
    ? { kind: b.kind, title: b.title, xTitle: b.xTitle, points: rows.map(r => ({ x: r[b.xField], y: r[b.yField], n: r[b.nField], bin: r[b.binField] })) }
    : {
        kind: b.kind, title: b.title, format: f, x: rows.map(r => String(pick(r, b.x))), series,
        xLabel: b.xLabel ?? '', xNote: b.xNote ? rows.map(r => r[b.xNote]) : undefined,
        yMin: b.yMin, yMax: b.yMax, ticks: b.ticks, divider: b.divider, labels: b.labels,
        note: b.note ? rows.map(r => fmts[b.note.format](r[b.note.field])) : undefined, noteLabel: b.note?.label,
      }
  const cols = b.table ?? [
    { label: b.xLabel || b.x, field: b.x },
    ...(b.series ?? []).map(sr => ({ label: sr.label, field: sr.field, format: f })),
    ...(b.note ? [{ label: b.note.label, field: b.note.field, format: b.note.format }] : []),
  ]
  const legend = series.length > 1 ? `<div class="legend">${series.map(sr => `<span><i class="s${sr.color}"></i>${esc(sr.label)}</span>`).join('')}</div>` : ''
  return `<figure class="chart">
          <figcaption><strong>${esc(b.title)}</strong>${b.caption ? `<span>${esc(b.caption)}</span>` : ''}</figcaption>
          ${legend}<div class="plot" data-chart="${esc(JSON.stringify(spec))}"></div>
          <details><summary>Data table</summary>${table({ head: cols.map(c => c.label), rows: rows.map(r => cols.map(c => { const v = pick(r, c.field); return c.format ? fmts[c.format](v) : String(v) })) })}</details>
        </figure>`
}

const section = (s, i, data) => `
      <section id="${esc(s.id)}">
        <h2><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(s.heading)}</h2>
        ${s.blocks.map(b => b.type === 'chart' ? chart(b, data) : blocks[b.type](b)).join('\n        ')}
      </section>`

mkdirSync(stage, { recursive: true })
writeFileSync(join(stage, 'index.html'), fill('index.template.html', {
  ...common,
  TITLE: esc(site.title ?? profile.name ?? 'Portfolio'),
  ROLE: esc(profile.role),
  ROLES: (profile.roles ?? [profile.role]).map(x => `<span>${esc(x)}</span>`).join(''),
  STATEMENT: esc(profile.statement),
  ABOUT: (profile.about ?? []).map(p => `<p>${esc(p)}</p>`).join('\n        '),
  PROFILE_LINKS: (profile.links ?? []).map(l => link(l, 'pill')).join(''),
  COUNT: String(projects.length),
  PROJECTS: projects.map(card).join(''),
  DETAILS: projects.map(detail).join(''),
}))

for (const p of projects.filter(hasDemo)) {
  const dir = join(stage, 'demo', p.slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), fill('page.template.html', {
    ...common,
    PROJECT: esc(p.name),
    PROJECT_SLUG: esc(p.slug),
    KICKER: 'Demo',
    PAGE_TITLE: esc(`${p.name} demo`),
    SUMMARY: esc(p.demo.summary ?? ''),
    MARK: mark(p),
    META: '',
    STATS: '',
    SECTIONS: `
      <video class="demo-video" controls playsinline preload="metadata" src="/${esc(p.demo.video)}#t=1">
        ${p.demo.captions && existsSync(join(work, p.demo.captions)) ? `<track kind="captions" src="/${esc(p.demo.captions)}" srclang="en" label="English">` : ''}
      </video>
      ${p.demo.note ? `<p class="note">${esc(p.demo.note)}</p>` : ''}
      ${creditsHtml(p)}`,
    SCRIPTS: '',
  }))
}

// Write-up pages: a project's own (p.page, under its parent's URL) and any remaining sub-projects.
const writeUps = projects.flatMap(p => [...(p.page ? [[ownerOf(p), { ...p.page, title: p.name, summary: p.tagline }]] : []), ...(p.subprojects ?? []).map(s => [p, s])])
for (const [p, s] of writeUps) {
  {
    const page = JSON.parse(readFileSync(join(work, s.content), 'utf8'))
    const data = page.charts ? JSON.parse(readFileSync(join(work, page.charts), 'utf8')) : {}
    const dir = join(stage, 'work', p.slug, s.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), fill('page.template.html', {
      ...common,
      PROJECT: esc(p.name),
      PROJECT_SLUG: esc(p.slug),
      KICKER: esc(page.kicker ?? 'Sub-project'),
      PAGE_TITLE: esc(page.title ?? s.title),
      SUMMARY: esc(page.summary ?? s.summary),
      MARK: mark(p),
      META: page.meta?.length ? `<dl class="meta">${page.meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '',
      STATS: page.stats?.length ? `<div class="stats">${page.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : '',
      SECTIONS: (page.sections ?? []).map((sec, i) => section(sec, i, data)).join(''),
      SCRIPTS: page.charts ? `<script src="/charts.js?v=${BUILD}" defer></script>` : '',
    }))
  }
}
