// Feedback icons for every project: learn more (data-info), thumbs up, thumbs down, suggest a feature, give feedback, open
// the demo. Put <div class="fb" data-app="nexus" data-name="NEXUS" data-demo="/nexus/#demo"></div>
// on a page that loads /feedback.css and /feedback.js; responses go to the feedback hub (/api/feedback/).
(function () {
  const API = '/api/feedback';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
  };
  let visitor = store.get('fb.visitor');
  if (!visitor) {
    visitor = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    store.set('fb.visitor', visitor);
  }
  const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    up: svg('<path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H7V10l4-8a3 3 0 0 1 3 3.9z"/>'),
    down: svg('<path d="M17 14V3"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.6 3H17v11l-4 8a3 3 0 0 1-3-3.9z"/>'),
    idea: svg('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14c.2-1 .7-1.7 1.4-2.5A6 6 0 1 0 6 8c0 1.3.5 2.4 1.5 3.5.7.8 1.2 1.5 1.4 2.5"/>'),
    feedback: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    demo: svg('<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/>'),
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function post(path, body) {
    let r;
    try {
      r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { throw new Error('Could not reach the feedback service. Please try again later.'); }
    if (!r.ok) {
      let msg = `Sorry, that did not go through (error ${r.status}). Please try again later.`;
      try { const j = await r.json(); if (typeof j.detail === 'string') msg = j.detail; } catch (e) {}
      throw new Error(msg);
    }
    return r.json();
  }

  // One dialog for suggestions, feedback and the optional "why" after a thumbs down.
  let dlg;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'fb-dlg';
    dlg.innerHTML = `<form method="dialog" novalidate>
      <h2 class="fb-title"></h2><p class="fb-sub"></p>
      <label class="fb-l"><span class="fb-q"></span><textarea name="text" rows="5" maxlength="2000" required></textarea></label>
      <div class="fb-row"><label class="fb-l">Name <small>optional</small><input name="name" maxlength="80" autocomplete="name"></label>
      <label class="fb-l">Role or company <small>optional</small><input name="role" maxlength="120" autocomplete="organization-title"></label></div>
      <label class="fb-l">Email <small>optional, only if you would like a reply</small><input name="email" type="email" maxlength="254" autocomplete="email"></label>
      <label class="fb-c"><input type="checkbox" name="consent"> You may use my email to reply to me about this.</label>
      <label class="fb-hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
      <p class="fb-note">Your message, the page and your country are stored to improve the project and removed after 12 months. Nothing is shared.</p>
      <p class="fb-err" role="alert"></p>
      <div class="fb-btns"><button type="button" class="fb-b fb-cancel">Cancel</button><button value="send" class="fb-b fb-primary">Send</button></div>
    </form>`;
    document.body.appendChild(dlg);
    const f = dlg.querySelector('form');
    f.querySelector('.fb-cancel').addEventListener('click', () => dlg.close());
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('.fb-err'), btn = f.querySelector('.fb-primary');
      const data = Object.fromEntries(new FormData(f));
      if ((data.text || '').trim().length < 2) { err.textContent = 'Please write a few words first.'; return; }
      if (data.email && !data.consent) { err.textContent = 'Please tick the box so I may use your email to reply, or leave the email empty.'; return; }
      btn.disabled = true; err.textContent = '';
      try {
        await post('/message', { app: dlg.dataset.app, kind: dlg.dataset.kind, visitor, page: location.pathname + location.hash,
          text: data.text, name: data.name || '', role: data.role || '', email: data.email || '', consent: !!data.consent, website: data.website || '' });
        const done = dlg;
        f.innerHTML = `<h2 class="fb-title">Thank you</h2><p class="fb-sub">Your ${done.dataset.kind === 'idea' ? 'suggestion' : 'feedback'} reached me.${data.email ? ' I will reply by email.' : ''}</p><div class="fb-btns"><button type="button" class="fb-b fb-primary">Close</button></div>`;
        dlg = null; // the next request gets a fresh form
        done.addEventListener('close', () => done.remove());
        f.querySelector('button').addEventListener('click', () => done.close());
        f.querySelector('button').focus();
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    return dlg;
  }
  const TEXT = {
    idea: ['Suggest a feature', 'What would make {name} more useful to you?', 'Your idea'],
    feedback: ['Give feedback', 'Anything about {name}: what works, what does not, what confused you.', 'Your feedback'],
    why: ['Thanks for the honest vote', 'What did not work for you in {name}? Optional, but it helps.', 'What could be better'],
  };
  function open(kind, app, name) {
    const d = dialog(), t = TEXT[kind];
    if (d.dataset.app !== app || d.dataset.kind !== kind) d.querySelector('form').reset();
    d.dataset.app = app; d.dataset.kind = kind;
    d.querySelector('.fb-title').textContent = t[0];
    d.querySelector('.fb-sub').textContent = t[1].replace('{name}', name);
    d.querySelector('.fb-q').textContent = t[2];
    d.querySelector('.fb-err').textContent = '';
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    d.querySelector('textarea').focus();
  }

  function mount(el) {
    const app = el.dataset.app, name = el.dataset.name || app, demo = el.dataset.demo, info = el.dataset.info;
    const b = (k, tip, extra = '') => `<button type="button" class="fb-i" data-k="${k}" aria-label="${esc(tip)}" data-tip="${esc(tip)}" ${extra}>${ICON[k]}</button>`;
    el.innerHTML = (info ? `<a class="fb-i" href="${esc(info)}" aria-label="Learn more about ${esc(name)}" data-tip="Learn more">${ICON.info}</a>` : '')
      + b('up', 'I like this', 'aria-pressed="false"') + b('down', 'Not for me', 'aria-pressed="false"')
      + b('idea', 'Suggest a feature') + b('feedback', 'Give feedback')
      + (demo ? `<a class="fb-i" href="${esc(demo)}" aria-label="Open the demo" data-tip="Open the demo">${ICON.demo}</a>` : '');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `Feedback on ${name}`);
    const show = () => {
      const v = store.get('fb.vote.' + app);
      el.querySelector('[data-k=up]').setAttribute('aria-pressed', String(v === '1'));
      el.querySelector('[data-k=down]').setAttribute('aria-pressed', String(v === '-1'));
    };
    show();
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('button.fb-i');
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === 'idea' || k === 'feedback') { open(k, app, name); return; }
      const cur = store.get('fb.vote.' + app), want = k === 'up' ? '1' : '-1', value = cur === want ? 0 : +want;
      store.set('fb.vote.' + app, value ? String(value) : null); show();
      try {
        await post('/vote', { app, visitor, value });
        btn.dataset.tip = value ? 'Thank you!' : (k === 'up' ? 'I like this' : 'Not for me');
        setTimeout(() => { btn.dataset.tip = k === 'up' ? 'I like this' : 'Not for me'; }, 1800);
        if (value === -1) open('why', app, name);
      } catch (x) { store.set('fb.vote.' + app, cur); show(); btn.dataset.tip = x.message; }
    });
  }
  const run = () => document.querySelectorAll('.fb[data-app]').forEach(mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
