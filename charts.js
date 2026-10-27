// Draws the charts on project pages from the spec render.mjs writes into each .plot[data-chart].
// SVG is drawn at the container's real width (and redrawn on resize), so text stays legible on a
// phone. Colours come from CSS tokens, so the theme switch restyles charts without a redraw.
// Every value is also in the data table under each chart; the tooltip only adds convenience.
(() => {
  const NS = 'http://www.w3.org/2000/svg'
  const fmt = {
    pct: v => (v * 100).toFixed(1) + '%',
    num: v => Math.round(v).toLocaleString('en'),
    dec: v => v.toFixed(2),
  }
  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    if (parent) parent.appendChild(n)
    return n
  }
  const text = (parent, x, y, s, cls, anchor = 'start') => {
    const t = el('text', { x, y, class: cls, 'text-anchor': anchor }, parent)
    t.textContent = s
    return t
  }
  const niceMax = (v, f) => f === 'pct' ? Math.min(1, Math.ceil(v * 10) / 10) : (() => {
    const p = 10 ** Math.floor(Math.log10(v)), m = v / p
    return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
  })()

  function tooltip(host) {
    const tip = document.createElement('div')
    tip.className = 'chart-tip'
    tip.hidden = true
    host.appendChild(tip)
    return {
      show(x, y, title, rows) {
        tip.replaceChildren()
        const h = document.createElement('div'); h.className = 'tip-title'; h.textContent = title; tip.appendChild(h)
        for (const [label, value, series] of rows) {
          const r = document.createElement('div'); r.className = 'tip-row'
          if (series) { const k = document.createElement('span'); k.className = `tip-key s${series}`; r.appendChild(k) }
          const v = document.createElement('strong'); v.textContent = value; r.appendChild(v)
          const l = document.createElement('span'); l.textContent = label; r.appendChild(l)
          tip.appendChild(r)
        }
        tip.hidden = false
        const w = host.clientWidth, tw = tip.offsetWidth
        tip.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px'
        tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px'
      },
      hide() { tip.hidden = true },
    }
  }

  // Vertical charts share a frame: y gridlines with labels, x labels under the plot.
  function frame(svg, W, H, m, yMax, f, ticks = 4) {
    const y = v => m.t + (H - m.t - m.b) * (1 - v / yMax)
    for (let i = 0; i <= ticks; i++) {
      const v = yMax * i / ticks
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i ? 'grid' : 'axis' }, svg)
      text(svg, m.l - 8, y(v) + 4, f === 'pct' ? Math.round(v * 100) + '%' : fmt[f](v), 'tick', 'end')
    }
    return y
  }

  const draw = {
    line(host, s, W) {
      const H = 280, m = { t: 34, r: 16, b: 34, l: 44 }
      const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
      const yMin = s.yMin ?? 0, yMax = s.yMax ?? 1
      const y = v => m.t + (H - m.t - m.b) * (1 - (v - yMin) / (yMax - yMin))
      const n = s.x.length, step = (W - m.l - m.r) / (n - 1), x = i => m.l + i * step
      const ticks = s.ticks ?? 4
      for (let i = 0; i <= ticks; i++) {
        const v = yMin + (yMax - yMin) * i / ticks
        el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i ? 'grid' : 'axis' }, svg)
        text(svg, m.l - 8, y(v) + 4, s.format === 'pct' ? Math.round(v * 100) + '%' : v.toFixed(1), 'tick', 'end')
      }
      s.x.forEach((l, i) => text(svg, x(i), H - m.b + 18, l, 'tick', 'middle'))
      if (s.divider) {
        const dx = (x(s.divider.after - 1) + x(s.divider.after)) / 2
        el('line', { x1: dx, x2: dx, y1: m.t - 8, y2: H - m.b, class: 'divider' }, svg)
        text(svg, dx - 8, m.t - 16, s.divider.labels[0], 'phase', 'end')
        text(svg, dx + 8, m.t - 16, s.divider.labels[1], 'phase')
      }
      for (const ser of s.series) {
        el('path', { d: ser.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(''), class: `line s${ser.color}` }, svg)
        ser.values.forEach((v, i) => el('circle', { cx: x(i), cy: y(v), r: 4, class: `dot s${ser.color}` }, svg))
      }
      const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' }, svg)
      const hit = el('rect', { x: m.l - step / 2, y: 0, width: W - m.l - m.r + step, height: H, fill: 'transparent', tabindex: 0 }, svg)
      const tip = tooltip(host)
      const at = i => {
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible')
        tip.show(x(i), Math.min(...s.series.map(r => y(r.values[i]))), `${s.xLabel} ${s.x[i]}${s.xNote ? ' · ' + s.xNote[i] : ''}`,
          s.series.map(r => [r.label, fmt[s.format](r.values[i]), r.color]))
      }
      let focus = n - 1
      hit.addEventListener('pointermove', e => at(Math.max(0, Math.min(n - 1, Math.round((e.offsetX - m.l) / step)))))
      hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hide() })
      hit.addEventListener('focus', () => at(focus))
      hit.addEventListener('blur', () => { cross.setAttribute('visibility', 'hidden'); tip.hide() })
      hit.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { focus = Math.max(0, Math.min(n - 1, focus + (e.key === 'ArrowRight' ? 1 : -1))); at(focus); e.preventDefault() }
      })
      return svg
    },

    columns(host, s, W) {
      const H = 260, m = { t: 24, r: 8, b: 40, l: 44 }
      const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
      const yMax = s.yMax ?? niceMax(Math.max(...s.series.flatMap(r => r.values)), s.format)
      const y = frame(svg, W, H, m, yMax, s.format)
      const groups = s.x.length, k = s.series.length
      const gw = (W - m.l - m.r) / groups, bw = Math.min(56, (gw * 0.72) / k)
      const tip = tooltip(host)
      s.x.forEach((label, g) => {
        const gx = m.l + g * gw + (gw - bw * k - 2 * (k - 1)) / 2
        // A range label ("0.4–0.5") that won't fit its column keeps only its lower bound.
        text(svg, m.l + g * gw + gw / 2, H - m.b + 18, gw < label.length * 7 ? label.split('–')[0] : label, 'tick', 'middle')
        s.series.forEach((ser, j) => {
          const v = ser.values[g], bx = gx + j * (bw + 2), top = y(v), base = y(0), h = Math.max(0, base - top)
          const r = Math.min(4, bw / 2, h)
          el('path', { d: `M${bx},${base}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${base}Z`, class: `bar s${ser.color}` }, svg)
          if (s.labels) text(svg, bx + bw / 2, top - 6, fmt[s.format](v), 'value', 'middle')
          const hit = el('rect', { x: bx - 2, y: m.t, width: bw + 4, height: base - m.t, fill: 'transparent', tabindex: 0 }, svg)
          const show = () => tip.show(bx + bw / 2, top, label, [[ser.label, fmt[s.format](v), k > 1 ? ser.color : 0], ...(s.extra ? [[s.extra.label, s.extra.values[g], 0]] : [])])
          hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show)
          hit.addEventListener('pointerleave', () => tip.hide()); hit.addEventListener('blur', () => tip.hide())
        })
      })
      return svg
    },

    rows(host, s, W) {
      const row = 46, m = { t: 4, r: 64, l: 0 }
      const ser = s.series[0], n = s.x.length, H = m.t + n * row
      const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
      const max = Math.max(...ser.values), xw = v => (W - m.l - m.r) * v / max
      const tip = tooltip(host)
      s.x.forEach((label, i) => {
        const top = m.t + i * row, v = ser.values[i], w = Math.max(2, xw(v))
        text(svg, m.l, top + 14, label, 'rowlabel')
        el('path', { d: `M${m.l},${top + 22}H${m.l + w - 4}Q${m.l + w},${top + 22} ${m.l + w},${top + 26}V${top + 32}Q${m.l + w},${top + 36} ${m.l + w - 4},${top + 36}H${m.l}Z`, class: `bar s${ser.color}` }, svg)
        text(svg, m.l + w + 8, top + 33, fmt[s.format](v) + (s.note ? ` · ${s.note[i]}` : ''), 'value')
        const hit = el('rect', { x: 0, y: top, width: W, height: row - 2, fill: 'transparent', tabindex: 0 }, svg)
        const show = () => tip.show(m.l + w / 2, top + 20, label, [[ser.label, fmt[s.format](v), 0], ...(s.note ? [[s.noteLabel, s.note[i], 0]] : [])])
        hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show)
        hit.addEventListener('pointerleave', () => tip.hide()); hit.addEventListener('blur', () => tip.hide())
      })
      return svg
    },

    reliability(host, s, W) {
      const H = Math.min(320, Math.max(240, W * 0.55)), m = { t: 16, r: 16, b: 42, l: 44 }
      const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
      const x = v => m.l + (W - m.l - m.r) * v, y = v => m.t + (H - m.t - m.b) * (1 - v)
      for (let i = 0; i <= 4; i++) {
        const v = i / 4
        el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i ? 'grid' : 'axis' }, svg)
        text(svg, m.l - 8, y(v) + 4, Math.round(v * 100) + '%', 'tick', 'end')
        text(svg, x(v), H - m.b + 18, Math.round(v * 100) + '%', 'tick', 'middle')
      }
      text(svg, (m.l + W - m.r) / 2, H - 6, s.xTitle, 'axis-title', 'middle')
      el('line', { x1: x(0), y1: y(0), x2: x(1), y2: y(1), class: 'divider' }, svg)
      text(svg, x(0.62) + 6, y(0.5), 'perfect calibration', 'phase')
      const p = s.points
      el('path', { d: p.map((d, i) => `${i ? 'L' : 'M'}${x(d.x)},${y(d.y)}`).join(''), class: 'line s1' }, svg)
      const tip = tooltip(host)
      p.forEach(d => {
        el('circle', { cx: x(d.x), cy: y(d.y), r: 4.5, class: 'dot s1' }, svg)
        const hit = el('circle', { cx: x(d.x), cy: y(d.y), r: 14, fill: 'transparent', tabindex: 0 }, svg)
        const show = () => tip.show(x(d.x), y(d.y), `Confidence ${d.bin}`, [['actual accuracy', fmt.pct(d.y), 0], ['mean confidence', fmt.pct(d.x), 0], ['test images', fmt.num(d.n), 0]])
        hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show)
        hit.addEventListener('pointerleave', () => tip.hide()); hit.addEventListener('blur', () => tip.hide())
      })
      return svg
    },
  }

  // A matrix on one continuous blue gradient. The fill is mixed in CSS from three theme tokens
  // (--heat-lo/-mid/-hi), so the theme switch recolours it without a redraw, and "near zero" stays a
  // visible tint in both themes rather than fading to the surface or to black. Where a cell is big
  // enough, values at or above `labelMin` are printed in it; text uses ink tokens, never a series hue.
  let gradients = 0
  const heatFill = t => t <= 0.5
    ? `color-mix(in oklab, var(--heat-mid) ${Math.round(t * 200)}%, var(--heat-lo))`
    : `color-mix(in oklab, var(--heat-hi) ${Math.round((t - 0.5) * 200)}%, var(--heat-mid))`
  draw.heatmap = (host, s, W) => {
    const n = s.labels.length, lw = Math.min(118, W * 0.3)
    const cell = Math.max(6, Math.floor((W - lw - 8) / n))
    // Column labels need room; on a narrow screen the row labels, tooltip and table carry them.
    const cols = cell >= 14, top = cols ? Math.min(104, 26 + lw * 0.62) : 8, H = top + n * cell + 52
    const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
    const [lo, hi] = s.domain, curve = s.scale === 'sqrt' ? Math.sqrt : v => v
    const at = v => Math.max(0, Math.min(1, curve(Math.max(0, (v - lo) / (hi - lo)))))
    const tip = tooltip(host)
    s.labels.forEach((l, i) => {
      text(svg, lw - 6, top + i * cell + cell / 2 + 4, l, 'tick', 'end')
      if (!cols) return
      const t = text(svg, 0, 0, l, 'tick')
      t.setAttribute('transform', `translate(${lw + i * cell + cell / 2 + 3},${top - 6}) rotate(-60)`)
    })
    s.matrix.forEach((row, i) => row.forEach((v, j) => {
      const t = at(v)
      const r = el('rect', { x: lw + j * cell, y: top + i * cell, width: cell - 1, height: cell - 1, rx: 2, class: 'heat', style: `fill:${heatFill(t)}`, tabindex: 0 }, svg)
      if (s.labelMin != null && cell >= 24 && v >= s.labelMin) {
        // Two decimals without the leading zero (".98") so similarities fit a small cell.
        const label = s.format === 'pct' ? Math.round(v * 100) : v.toFixed(2).replace(/^0(?=\.)/, '')
        text(svg, lw + j * cell + (cell - 1) / 2, top + i * cell + cell / 2 + 3.5, String(label), t > 0.62 ? 'heat-label strong' : 'heat-label', 'middle')
      }
      const show = () => tip.show(lw + j * cell + cell / 2, top + i * cell, `${s.rowTitle}: ${s.labels[i]}`,
        [[`${s.colTitle}: ${s.labels[j]}`, fmt[s.format](v), 0], ...(s.counts ? [['posts', fmt.num(s.counts[i][j]), 0]] : [])])
      r.addEventListener('pointerenter', show); r.addEventListener('focus', show)
      r.addEventListener('pointerleave', () => tip.hide()); r.addEventListener('blur', () => tip.hide())
    }))
    // The legend is the same gradient, drawn continuously.
    const id = `heat-grad-${++gradients}`, ly = top + n * cell + 14, lwid = Math.min(220, W - lw - 70)
    const grad = el('linearGradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 }, el('defs', {}, svg))
    for (let k = 0; k <= 10; k++) el('stop', { offset: `${k * 10}%`, style: `stop-color:${heatFill(k / 10)}` }, grad)
    text(svg, lw - 6, ly + 10, fmt[s.format](lo), 'tick', 'end')
    el('rect', { x: lw, y: ly, width: lwid, height: 12, rx: 3, fill: `url(#${id})` }, svg)
    text(svg, lw + lwid + 6, ly + 10, fmt[s.format](hi), 'tick')
    const note = [s.legendNote, s.scale === 'sqrt' ? 'square-root scale' : ''].filter(Boolean).join(' · ')
    if (note) text(svg, lw, ly + 30, note, 'tick')
    return svg
  }

  // Points on two numeric axes, one colour per group and the last group ("Other") in grey. Each
  // named group is also outlined — an ellipse holding about 86% of its points (two standard
  // deviations) — and named on the plot, so the clusters are told apart without relying on colour.
  // The tooltip follows the nearest point, so 1,500 dots need no hit target each.
  draw.scatter = (host, s, W) => {
    const H = Math.min(440, Math.max(300, W * 0.64)), m = { t: 12, r: 12, b: 40, l: 44 }
    const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
    const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1])
    const pad = (a, b) => [a - (b - a) * 0.04, b + (b - a) * 0.04]
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys))
    const x = v => m.l + (W - m.l - m.r) * (v - x0) / (x1 - x0), y = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0))
    for (let i = 0; i <= 4; i++) {
      const vy = y0 + (y1 - y0) * i / 4, vx = x0 + (x1 - x0) * i / 4
      el('line', { x1: m.l, x2: W - m.r, y1: y(vy), y2: y(vy), class: i ? 'grid' : 'axis' }, svg)
      text(svg, m.l - 8, y(vy) + 4, vy.toFixed(2), 'tick', 'end')
      text(svg, x(vx), H - m.b + 18, vx.toFixed(2), 'tick', 'middle')
    }
    text(svg, (m.l + W - m.r) / 2, H - 6, s.xTitle, 'axis-title', 'middle')
    const other = s.groups.length - 1, cls = g => g === other ? 'other' : `c${g + 1}`
    // Each named group's ellipse, from the covariance of its points in screen space.
    // A group of one or two points has no shape to outline; it is still coloured and in the legend.
    const shapes = s.groups.slice(0, other).map((name, g) => {
      const pts = s.points.filter(p => p[2] === g).map(([a, b]) => [x(a), y(b)])
      if (pts.length < 3) return null
      const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length, my = pts.reduce((t, p) => t + p[1], 0) / pts.length
      let sxx = 0, syy = 0, sxy = 0
      for (const [a, b] of pts) { sxx += (a - mx) ** 2; syy += (b - my) ** 2; sxy += (a - mx) * (b - my) }
      sxx /= pts.length; syy /= pts.length; sxy /= pts.length
      const tr = (sxx + syy) / 2, det = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2)
      const l1 = tr + det, l2 = Math.max(tr - det, 1e-6), angle = Math.atan2(l1 - sxx, sxy || 1e-9) * 180 / Math.PI
      return { name, g, mx, my, rx: 2 * Math.sqrt(l1), ry: 2 * Math.sqrt(l2), angle }
    }).filter(Boolean)
    // Outlines stay inside the plot: a small, spread-out group can have an ellipse larger than the axes.
    const clip = `scatter-clip-${++gradients}`
    el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }, el('clipPath', { id: clip }, el('defs', {}, svg)))
    const outlines = el('g', { 'clip-path': `url(#${clip})` }, svg)
    for (const e of shapes)
      el('ellipse', { cx: e.mx, cy: e.my, rx: e.rx, ry: e.ry, transform: `rotate(${e.angle} ${e.mx} ${e.my})`, class: `cluster ${cls(e.g)}` }, outlines)
    // "Other" first, so the named groups sit on top of it.
    const order = [...s.points.keys()].sort((a, b) => (s.points[b][2] === other) - (s.points[a][2] === other))
    for (const i of order) {
      const [px, py, g] = s.points[i]
      el('circle', { cx: x(px), cy: y(py), r: 2.6, class: `pt ${cls(g)}` }, svg)
    }
    // Names on top, at each cluster's centre, with a surface halo so they read over the dots.
    for (const e of shapes) {
      const label = text(svg, Math.max(m.l + 40, Math.min(W - m.r - 40, e.mx)), e.my + 4, e.name, 'cluster-label', 'middle')
      label.setAttribute('paint-order', 'stroke')
    }
    const ring = el('circle', { r: 6, class: 'pt-ring', visibility: 'hidden' }, svg)
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg)
    const tip = tooltip(host)
    hit.addEventListener('pointermove', e => {
      let best = 0, d = Infinity
      s.points.forEach(([px, py], i) => { const dd = (x(px) - e.offsetX) ** 2 + (y(py) - e.offsetY) ** 2; if (dd < d) { d = dd; best = i } })
      const [px, py, g] = s.points[best]
      ring.setAttribute('cx', x(px)); ring.setAttribute('cy', y(py)); ring.setAttribute('visibility', 'visible')
      tip.show(x(px), y(py), s.groups[g], [['PC1', px.toFixed(2), 0], ['PC2', py.toFixed(2), 0]])
    })
    hit.addEventListener('pointerleave', () => { ring.setAttribute('visibility', 'hidden'); tip.hide() })
    return svg
  }

  // Curves over a 0–1 by 0–1 square (ROC), with the chance diagonal.
  draw.xy = (host, s, W) => {
    const H = Math.min(320, Math.max(240, W * 0.55)), m = { t: 16, r: 16, b: 42, l: 44 }
    const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': s.title })
    const x = v => m.l + (W - m.l - m.r) * v, y = v => m.t + (H - m.t - m.b) * (1 - v)
    for (let i = 0; i <= 4; i++) {
      const v = i / 4
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i ? 'grid' : 'axis' }, svg)
      text(svg, m.l - 8, y(v) + 4, Math.round(v * 100) + '%', 'tick', 'end')
      text(svg, x(v), H - m.b + 18, Math.round(v * 100) + '%', 'tick', 'middle')
    }
    text(svg, (m.l + W - m.r) / 2, H - 6, s.xTitle, 'axis-title', 'middle')
    if (s.yTitle) text(svg, m.l + 6, m.t + 12, s.yTitle, 'axis-title')
    el('line', { x1: x(0), y1: y(0), x2: x(1), y2: y(1), class: 'divider' }, svg)
    text(svg, x(0.62) + 6, y(0.56), s.diagonal ?? 'chance', 'phase')
    s.series.forEach((ser, k) => el('path', { d: ser.points.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a)},${y(b)}`).join(''), class: `line s${k + 1}` }, svg))
    const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' }, svg)
    const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg)
    const tip = tooltip(host)
    hit.addEventListener('pointermove', e => {
      const fx = Math.max(0, Math.min(1, (e.offsetX - m.l) / (W - m.l - m.r)))
      cross.setAttribute('x1', x(fx)); cross.setAttribute('x2', x(fx)); cross.setAttribute('visibility', 'visible')
      const at = ser => ser.points.reduce((b, p) => (Math.abs(p[0] - fx) < Math.abs(b[0] - fx) ? p : b))
      tip.show(x(fx), m.t + 20, `${s.xTitle} ${fmt.pct(fx)}`, s.series.map((ser, k) => [ser.label, fmt.pct(at(ser)[1]), k + 1]))
    })
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hide() })
    return svg
  }

  const plots = [...document.querySelectorAll('.plot[data-chart]')].map(host => ({ host, spec: JSON.parse(host.dataset.chart) }))
  const render = () => plots.forEach(({ host, spec }) => {
    const W = Math.floor(host.clientWidth)
    if (!W || host._w === W) return
    host._w = W
    host.querySelectorAll('svg, .chart-tip').forEach(n => n.remove())
    host.prepend(draw[spec.kind](host, spec, W))
  })
  render()
  let t
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 120) })
})()
