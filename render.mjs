// Render the portfolio from portfolio.json: the index, plus one page per sub-project.
//   node render.mjs <work dir> <stage dir> "<built slugs>" <likec4 version>
// A project gets an "Architecture" link only when its LikeC4 model was built this run, so a
// project can be listed before it has a model. `logoTile: true` sets a logo on a light tile, for
// marks drawn in dark ink that would vanish on the dark theme. A sub-project's page content lives in
// its own JSON file (see pages/) and is written to /work/<project>/<sub-project>/. Everything is
// escaped: the JSON is content, not HTML.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const fill = (template, values) => readFileSync(join(work, template), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m)

const mark = p => p.logo
  ? `<img class="mark${p.logoTile ? ' mark-tile' : ''}" src="/${esc(p.logo)}" alt="" width="56" height="56">`
  : `<span class="mark mark-text" aria-hidden="true">${initials(p.name)}</span>`

// The stored choice is applied before first paint so a dark-mode visitor never sees a white flash.
// Storage can be unavailable (private windows, blocked site data); the page then follows the system.
const THEME_SCRIPT = `<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}
function toggleTheme(){var r=document.documentElement,d=r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),n=d==='dark'?'light':'dark';r.dataset.theme=n;try{localStorage.setItem('theme',n)}catch(e){}}</script>`
const THEME_BUTTON = `<button class="theme-toggle" type="button" onclick="toggleTheme()" aria-label="Switch between light and dark theme" title="Light / dark theme">
          <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
          <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>`

const common = {
  NAME: esc(profile.name),
  SHORT_NAME: esc(profile.shortName ?? profile.name),
  THEME_SCRIPT,
  THEME_BUTTON,
  YEAR: String(new Date().getUTCFullYear()),
  STAMP: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  VERSION: esc(version),
}

const card = p => {
  const links = [...(p.links ?? [])]
  if (built.has(p.slug)) links.push({ label: 'Architecture', href: `/${p.slug}/` })
  const subs = p.subprojects ?? []
  return `
      <article class="project" id="${esc(p.slug)}">
        <header>
          ${mark(p)}
          <div>
            <h3>${esc(p.name)}</h3>
            <p class="tagline">${esc(p.tagline)}</p>
          </div>
          ${p.status ? `<span class="status">${esc(p.status)}</span>` : ''}
        </header>
        <p>${esc(p.description)}</p>
        ${p.highlights?.length ? `<ul class="highlights">${p.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${p.stack?.length ? `<ul class="stack">${p.stack.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        ${subs.length ? `<div class="subprojects"><h4>Sub-projects</h4>${subs.map(s => `<a class="subproject" href="${subHref(p, s)}"><div><strong>${esc(s.title)}</strong><span>${esc(s.summary)}</span></div><span class="arrow" aria-hidden="true">→</span></a>`).join('')}</div>` : ''}
        <footer>
          ${p.context ? `<span class="context">${esc(p.context)}</span>` : '<span></span>'}
          <nav>${links.map(l => link(l)).join('')}</nav>
        </footer>
      </article>`
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
const chart = (b, data) => {
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
  STATEMENT: esc(profile.statement),
  ABOUT: (profile.about ?? []).map(p => `<p>${esc(p)}</p>`).join('\n        '),
  PROFILE_LINKS: (profile.links ?? []).map(l => link(l, 'pill')).join(''),
  COUNT: String(projects.length),
  PROJECTS: projects.map(card).join(''),
}))

for (const p of projects) {
  for (const s of p.subprojects ?? []) {
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
      SCRIPTS: page.charts ? '<script src="/charts.js" defer></script>' : '',
    }))
  }
}
