"""Feedback hub: votes, feature suggestions and feedback from every project, in one place.

Public endpoints (called by /feedback.js on the portfolio and on each product's pages):
  POST /api/feedback/vote      {app, visitor, value: 1 | -1 | 0}          one vote per visitor per app
  POST /api/feedback/message   {app, visitor, kind: idea | feedback | why, text, name?, email?, role?, consent, page?, website?}
Private (HTTP basic auth, user "admin", password FEEDBACK_ADMIN_PASSWORD):
  GET  /api/feedback/admin            filterable by app, kind and date
  GET  /api/feedback/admin.csv        the same rows as CSV
  POST /api/feedback/admin/delete     {id} removes one message (requests to erase personal data)

Stored: what the responder typed, the app, the page, a random visitor ID (to keep one vote per
visitor), the country Cloudflare reports, and the time. IP addresses are used in memory for rate
limiting only and never stored. New items are posted to a private Discord channel when
FEEDBACK_DISCORD_WEBHOOK is set; the webhook URL never reaches the browser.
"""
import csv
import hmac
import html
import io
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field, field_validator

DB = os.environ.get("FEEDBACK_DB", "/data/feedback.db")
APPS = {a.strip() for a in os.environ.get("FEEDBACK_APPS", "mealsenseai,cerebro,nexus").split(",") if a.strip()}
WEBHOOK = os.environ.get("FEEDBACK_DISCORD_WEBHOOK", "").strip()
ADMIN_PASSWORD = os.environ.get("FEEDBACK_ADMIN_PASSWORD", "")
RETENTION_DAYS = int(os.environ.get("FEEDBACK_RETENTION_DAYS", "365"))
KINDS = {"idea": "Feature suggestion", "feedback": "Feedback", "why": "Reason for a thumbs down"}
VISITOR = re.compile(r"^[A-Za-z0-9-]{8,64}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")

app = FastAPI(title="Feedback hub", docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.Lock()


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


def init() -> None:
    os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
    with closing(db()) as con, con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS votes (app TEXT NOT NULL, visitor TEXT NOT NULL, value INTEGER NOT NULL,
            country TEXT, updated TEXT NOT NULL, PRIMARY KEY (app, visitor));
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, app TEXT NOT NULL, kind TEXT NOT NULL,
            text TEXT NOT NULL, name TEXT, email TEXT, role TEXT, consent INTEGER NOT NULL DEFAULT 0, page TEXT,
            visitor TEXT, country TEXT, created TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_app ON messages (app, kind, created);
        """)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        con.execute("DELETE FROM messages WHERE created < ?", (cutoff,))


init()


# ---------- abuse limits: per client address, in memory only ----------
HITS: dict[tuple[str, str], deque] = defaultdict(deque)
LIMITS = {"vote": (60, 3600), "message": (10, 3600)}


def client(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (request.headers.get("x-forwarded-for", "").split(",")[0].strip()) or (request.client.host if request.client else "?")


def limited(request: Request, what: str) -> None:
    n, window = LIMITS[what]
    q, now = HITS[(client(request), what)], time.monotonic()
    with lock:
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= n:
            raise HTTPException(429, "Too many requests. Please try again later.")
        q.append(now)


def country(request: Request) -> str | None:
    c = request.headers.get("cf-ipcountry", "")
    return c[:2].upper() if re.fullmatch(r"[A-Za-z]{2}", c) else None


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------- Discord: alerts only; the database is the record ----------
def discord_safe(s: str, n: int) -> str:
    s = re.sub(r"([\\*_~`|>#\[\]()@])", r"\\\1", s or "")
    return s[:n] + ("…" if len(s) > n else "")


def notify(content: str) -> None:
    if not WEBHOOK:
        return

    def send() -> None:
        try:
            httpx.post(WEBHOOK, json={"content": content, "allowed_mentions": {"parse": []}}, timeout=8)
        except Exception as e:  # an alert that fails must never lose the feedback
            print(f"discord: {type(e).__name__}", flush=True)

    threading.Thread(target=send, daemon=True).start()


# ---------- public API ----------
class Vote(BaseModel):
    app: str
    visitor: str
    value: int = Field(ge=-1, le=1)


class Message(BaseModel):
    app: str
    visitor: str
    kind: str
    text: str = Field(min_length=2, max_length=2000)
    name: str = Field("", max_length=80)
    email: str = Field("", max_length=254)
    role: str = Field("", max_length=120)
    consent: bool = False
    page: str = Field("", max_length=300)
    website: str = ""  # honeypot: people never see it, bots fill it

    @field_validator("text", "name", "role", "page")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


def check_common(app_: str, visitor: str) -> None:
    if app_ not in APPS:
        raise HTTPException(400, "Unknown app")
    if not VISITOR.match(visitor):
        raise HTTPException(400, "Bad visitor id")


@app.get("/api/feedback/healthz")
def healthz():
    return {"ok": True}


@app.post("/api/feedback/vote")
def vote(v: Vote, request: Request):
    check_common(v.app, v.visitor)
    limited(request, "vote")
    with closing(db()) as con, con:
        old = con.execute("SELECT value FROM votes WHERE app=? AND visitor=?", (v.app, v.visitor)).fetchone()
        if v.value == 0:
            con.execute("DELETE FROM votes WHERE app=? AND visitor=?", (v.app, v.visitor))
        else:
            con.execute("INSERT INTO votes (app, visitor, value, country, updated) VALUES (?,?,?,?,?) "
                        "ON CONFLICT (app, visitor) DO UPDATE SET value=excluded.value, country=excluded.country, updated=excluded.updated",
                        (v.app, v.visitor, v.value, country(request), now()))
        up, down = con.execute("SELECT COALESCE(SUM(value=1),0), COALESCE(SUM(value=-1),0) FROM votes WHERE app=?", (v.app,)).fetchone()
    if v.value and (not old or old["value"] != v.value):
        notify(f"{'👍' if v.value > 0 else '👎'} **{v.app}** · now {up} 👍 / {down} 👎")
    return {"ok": True, "value": v.value}


@app.post("/api/feedback/message")
def message(m: Message, request: Request):
    check_common(m.app, m.visitor)
    if m.kind not in KINDS:
        raise HTTPException(400, "Unknown kind")
    if m.website:  # honeypot filled: accept quietly, store nothing
        return {"ok": True}
    email = m.email.strip()
    if email and not EMAIL.match(email):
        raise HTTPException(400, "That email address does not look right.")
    if email and not m.consent:
        raise HTTPException(400, "Please tick the box so I may use your email to reply.")
    limited(request, "message")
    with closing(db()) as con, con:
        cur = con.execute("INSERT INTO messages (app, kind, text, name, email, role, consent, page, visitor, country, created) "
                          "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                          (m.app, m.kind, m.text, m.name or None, email or None, m.role or None, int(m.consent and bool(email)),
                           m.page or None, m.visitor, country(request), now()))
        mid = cur.lastrowid
    who = " · ".join(x for x in [m.name, m.role, "email given" if email else "", country(request) or ""] if x)
    notify(f"{'💡' if m.kind == 'idea' else '💬'} **{KINDS[m.kind]}** · **{m.app}** · #{mid}\n> {discord_safe(m.text, 900)}"
           + (f"\n— {discord_safe(who, 200)}" if who else ""))
    return {"ok": True, "id": mid}


# ---------- private: the consolidated view ----------
basic = HTTPBasic()


def admin(cred: HTTPBasicCredentials = Depends(basic)) -> None:
    ok = bool(ADMIN_PASSWORD) and hmac.compare_digest(cred.username, "admin") and hmac.compare_digest(cred.password, ADMIN_PASSWORD)
    if not ok:
        raise HTTPException(401, "Sign in", headers={"WWW-Authenticate": 'Basic realm="feedback"'})


def query(app_: str, kind: str, since: str, until: str):
    where, args = [], []
    if app_:
        where.append("app=?"); args.append(app_)
    if kind:
        where.append("kind=?"); args.append(kind)
    if since:
        where.append("created>=?"); args.append(since)
    if until:
        where.append("created<?"); args.append(until + "T99")
    sql = "SELECT * FROM messages" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY created DESC LIMIT 5000"
    with closing(db()) as con:
        rows = con.execute(sql, args).fetchall()
        votes = con.execute("SELECT app, COALESCE(SUM(value=1),0) up, COALESCE(SUM(value=-1),0) down FROM votes GROUP BY app").fetchall()
        counts = con.execute("SELECT app, kind, COUNT(*) n FROM messages GROUP BY app, kind").fetchall()
    return rows, votes, counts


DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def params(app_: str, kind: str, since: str, until: str):
    return (app_ if app_ in APPS else "", kind if kind in KINDS else "",
            since if DATE.match(since or "") else "", until if DATE.match(until or "") else "")


@app.get("/api/feedback/admin", response_class=HTMLResponse, dependencies=[Depends(admin)])
def admin_page(app_: str = "", kind: str = "", since: str = "", until: str = ""):
    app_, kind, since, until = params(app_, kind, since, until)
    rows, votes, counts = query(app_, kind, since, until)
    e = html.escape
    nonce = secrets.token_urlsafe(12)
    per = {a: {"up": 0, "down": 0, "idea": 0, "feedback": 0, "why": 0} for a in sorted(APPS)}
    for v in votes:
        if v["app"] in per:
            per[v["app"]].update(up=v["up"], down=v["down"])
    for c in counts:
        if c["app"] in per:
            per[c["app"]][c["kind"]] = c["n"]
    opt = lambda vals, cur, labels=None: "".join(f'<option value="{e(v)}"{" selected" if v == cur else ""}>{e((labels or {}).get(v, v) or "All")}</option>' for v in vals)
    q = "&".join(f"{k}={e(v)}" for k, v in [("app_", app_), ("kind", kind), ("since", since), ("until", until)] if v)
    body = "".join(
        f'<tr><td class="m">{e(r["created"][:16].replace("T", " "))}</td><td>{e(r["app"])}</td><td>{e(KINDS.get(r["kind"], r["kind"]))}</td>'
        f'<td class="t">{e(r["text"])}{"<div class=m>" + e(r["page"]) + "</div>" if r["page"] else ""}</td>'
        f'<td>{e(r["name"] or "")}<div class="m">{e(r["role"] or "")}</div></td>'
        f'<td>{("<a href=\"mailto:" + e(r["email"]) + "\">" + e(r["email"]) + "</a>") if r["email"] else ""}</td>'
        f'<td class="m">{e(r["country"] or "")}</td>'
        f'<td><form method="post" action="/api/feedback/admin/delete" data-del><input type="hidden" name="id" value="{r["id"]}"><button>Delete</button></form></td></tr>'
        for r in rows)
    summary = "".join(f'<tr><td><a href="?app_={e(a)}">{e(a)}</a></td><td>{s["up"]}</td><td>{s["down"]}</td><td>{s["idea"]}</td><td>{s["feedback"]}</td><td>{s["why"]}</td></tr>' for a, s in per.items())
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedback</title><style nonce="{nonce}">
body{{font:14px/1.5 system-ui,sans-serif;margin:0;padding:20px;color:#18181b;background:#fafaf9}}h1{{font-size:20px;margin:0 0 14px}}
table{{border-collapse:collapse;width:100%;background:#fff}}th,td{{border-bottom:1px solid #e7e5e4;padding:7px 9px;text-align:left;vertical-align:top}}
th{{font-size:12px;color:#5f5f68;text-transform:uppercase;letter-spacing:.04em}}.t{{max-width:520px;white-space:pre-wrap}}.m{{color:#5f5f68;font-size:12px}}
form.f{{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:18px 0}}label{{display:grid;gap:3px;font-size:12px;color:#5f5f68}}
select,input,button{{font:inherit;padding:5px 8px}}.sum{{max-width:620px;margin-bottom:8px}}.wrap{{overflow-x:auto}}
</style></head><body><h1>Feedback across projects</h1>
<table class="sum"><tr><th>App</th><th>👍</th><th>👎</th><th>Suggestions</th><th>Feedback</th><th>Why 👎</th></tr>{summary}</table>
<form class="f" method="get"><label>App<select name="app_">{opt([""] + sorted(APPS), app_)}</select></label>
<label>Type<select name="kind">{opt([""] + list(KINDS), kind, KINDS)}</select></label>
<label>From<input type="date" name="since" value="{e(since)}"></label><label>To<input type="date" name="until" value="{e(until)}"></label>
<button>Filter</button> <a href="?">Clear</a> · <a href="/api/feedback/admin.csv?{q}">Download CSV</a></form>
<p class="m">{len(rows)} message(s). Emails are stored only with the responder's consent, to reply. Messages older than {RETENTION_DAYS} days are removed.</p>
<div class="wrap"><table><tr><th>When (UTC)</th><th>App</th><th>Type</th><th>Message</th><th>Name / role</th><th>Email</th><th>Country</th><th></th></tr>{body}</table></div>
<script nonce="{nonce}">document.querySelectorAll('[data-del]').forEach(f=>f.addEventListener('submit',e=>{{if(!confirm('Delete this message for good?'))e.preventDefault()}}))</script>
</body></html>"""
    return HTMLResponse(page, headers={"Content-Security-Policy": f"default-src 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}'; form-action 'self'; frame-ancestors 'none'",
                                       "Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.get("/api/feedback/admin.csv", dependencies=[Depends(admin)])
def admin_csv(app_: str = "", kind: str = "", since: str = "", until: str = ""):
    rows, _, _ = query(*params(app_, kind, since, until))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "created_utc", "app", "type", "message", "name", "role", "email", "consent", "country", "page"])
    safe = lambda s: ("'" + s) if s and s[0] in "=+-@\t\r" else (s or "")  # no formulas when opened in a spreadsheet
    for r in rows:
        w.writerow([r["id"], r["created"], r["app"], KINDS.get(r["kind"], r["kind"]), safe(r["text"]), safe(r["name"]), safe(r["role"]),
                    safe(r["email"]), r["consent"], r["country"] or "", safe(r["page"])])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="feedback.csv"', "Cache-Control": "no-store"})


@app.post("/api/feedback/admin/delete", dependencies=[Depends(admin)])
async def admin_delete(request: Request):
    # The browser re-sends basic-auth credentials, so refuse deletes started from another site.
    site, origin = request.headers.get("sec-fetch-site"), request.headers.get("origin")
    if site not in (None, "same-origin") or (origin and origin.split("://")[-1] != request.headers.get("host")):
        raise HTTPException(403, "Delete from the admin page")
    form = await request.body()
    m = re.search(rb"(?:^|&)id=(\d+)", form)
    if not m:
        raise HTTPException(400, "id required")
    with closing(db()) as con, con:
        con.execute("DELETE FROM messages WHERE id=?", (int(m.group(1)),))
    return PlainTextResponse("", status_code=303, headers={"Location": "/api/feedback/admin"})
