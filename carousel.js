// Projects carousel: native swipe and scroll-snap; this marks the centred card, shows its details, and adds dots,
// arrows, ← → keys and mouse drag. Without it the row still scrolls and every detail is shown.
(function () {
  const track = document.querySelector('.track');
  if (!track) return;
  const slides = [...track.querySelectorAll('.slide')], details = [...document.querySelectorAll('.detail')];
  const nav = document.querySelector('.carousel-nav'), dots = nav.querySelector('.dots');
  const prev = nav.querySelector('.prev'), next = nav.querySelector('.next'), count = document.getElementById('work-count');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let cur = -1;
  const btns = slides.map((s, i) => {
    const b = document.createElement('button');
    b.className = 'dot'; b.type = 'button'; b.setAttribute('aria-label', 'Show ' + s.getAttribute('aria-label'));
    b.addEventListener('click', () => go(i)); dots.appendChild(b); return b;
  });
  nav.hidden = false;
  const centre = s => s.offsetLeft - (track.clientWidth - s.offsetWidth) / 2;
  function go(i, instant) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: centre(slides[i]), behavior: instant || calm.matches ? 'auto' : 'smooth' });
  }
  function mark() {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bd = Infinity;
    slides.forEach((s, i) => { const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
    if (best === cur) return;
    cur = best;
    slides.forEach((s, i) => { const on = i === best; s.classList.toggle('active', on); s.setAttribute('aria-hidden', on ? 'false' : 'true');
      s.querySelectorAll('a, button').forEach(a => { if (on) a.removeAttribute('tabindex'); else a.tabIndex = -1; }); });
    btns.forEach((b, i) => b.setAttribute('aria-current', i === best ? 'true' : 'false'));
    details.forEach((d, i) => { d.hidden = i !== best; });
    prev.disabled = best === 0; next.disabled = best === slides.length - 1;
    if (count) count.textContent = `${best + 1} / ${slides.length}`;
  }
  let raf = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
  prev.addEventListener('click', () => go(cur - 1));
  next.addEventListener('click', () => go(cur + 1));
  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
  });
  // A click on a side card (even on its buttons) brings it to the centre instead.
  slides.forEach((s, i) => s.addEventListener('click', e => { if (i !== cur) { e.preventDefault(); e.stopPropagation(); if (!dragged) go(i); } }, true));
  // Mouse drag on desktop; touch and trackpads scroll natively.
  let down = false, dragged = false, x0 = 0, s0 = 0;
  track.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button) return; down = true; dragged = false; x0 = e.clientX; s0 = track.scrollLeft; });
  addEventListener('pointermove', e => {
    if (!down) return; const dx = e.clientX - x0;
    if (!dragged && Math.abs(dx) > 5) { dragged = true; track.classList.add('drag'); }
    if (dragged) track.scrollLeft = s0 - dx;
  });
  addEventListener('pointerup', () => {
    if (!down) return; down = false;
    if (dragged) { track.classList.remove('drag'); mark(); go(cur); setTimeout(() => { dragged = false; }, 0); }
  });
  track.addEventListener('click', e => { if (dragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  // A link to #nexus (or any project) opens on that card.
  const fromHash = () => { const i = slides.findIndex(s => '#' + s.id === location.hash); if (i >= 0) go(i, true); };
  addEventListener('hashchange', fromHash);
  addEventListener('resize', () => go(cur, true));
  mark(); go(0, true); fromHash();
})();
