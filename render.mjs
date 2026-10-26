// Render the portfolio index from portfolio.json into the HTML template.
//   node render.mjs <portfolio.json> <template.html> <out.html> "<built slugs>" <likec4 version>
// A project gets an "Architecture" link only when its LikeC4 model was built this run, so a
// project can be listed before it has a model. `logoTile: true` sets a logo on a light tile, for
// marks drawn in dark ink that would vanish on the dark theme. Everything is escaped: the JSON is content, not HTML.
import { readFileSync, writeFileSync } from 'node:fs'

const [data, template, out, builtArg = '', version = ''] = process.argv.slice(2)
const { site = {}, profile = {}, projects = [] } = JSON.parse(readFileSync(data, 'utf8'))
const built = new Set(builtArg.split(/\s+/).filter(Boolean))

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const external = href => /^https?:\/\//.test(href)
const link = ({ label, href }, cls = '') =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}"${external(href) ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}</a>`
const initials = name => esc(name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())

const card = p => {
  const links = [...(p.links ?? [])]
  if (built.has(p.slug)) links.push({ label: 'Architecture', href: `/${p.slug}/` })
  const mark = p.logo
    ? `<img class="mark${p.logoTile ? ' mark-tile' : ''}" src="${esc(p.logo)}" alt="" width="56" height="56">`
    : `<span class="mark mark-text" aria-hidden="true">${initials(p.name)}</span>`
  return `
      <article class="project" id="${esc(p.slug)}">
        <header>
          ${mark}
          <div>
            <h3>${esc(p.name)}</h3>
            <p class="tagline">${esc(p.tagline)}</p>
          </div>
          ${p.status ? `<span class="status">${esc(p.status)}</span>` : ''}
        </header>
        <p>${esc(p.description)}</p>
        ${p.highlights?.length ? `<ul class="highlights">${p.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${p.stack?.length ? `<ul class="stack">${p.stack.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        <footer>
          ${p.context ? `<span class="context">${esc(p.context)}</span>` : '<span></span>'}
          <nav>${links.map(l => link(l)).join('')}</nav>
        </footer>
      </article>`
}

const values = {
  TITLE: esc(site.title ?? profile.name ?? 'Portfolio'),
  NAME: esc(profile.name),
  SHORT_NAME: esc(profile.shortName ?? profile.name),
  ROLE: esc(profile.role),
  STATEMENT: esc(profile.statement),
  ABOUT: (profile.about ?? []).map(p => `<p>${esc(p)}</p>`).join('\n        '),
  PROFILE_LINKS: (profile.links ?? []).map(l => link(l, 'pill')).join(''),
  COUNT: String(projects.length),
  PROJECTS: projects.map(card).join(''),
  YEAR: String(new Date().getUTCFullYear()),
  STAMP: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  VERSION: esc(version),
}
writeFileSync(out, readFileSync(template, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m))
