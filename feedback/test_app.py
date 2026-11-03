import importlib, os, sys
from fastapi.testclient import TestClient

def make(tmp_path, monkeypatch, **env):
    monkeypatch.setenv("FEEDBACK_DB", str(tmp_path / "f.db")); monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "pw")
    for k, v in env.items(): monkeypatch.setenv(k, v)
    sys.modules.pop("app", None); import app as m; m.HITS.clear(); return m, TestClient(m.app)

V = "visitor-1234"

def test_vote_toggle_and_counts(tmp_path, monkeypatch):
    m, c = make(tmp_path, monkeypatch)
    assert c.post("/api/feedback/vote", json={"app": "nexus", "visitor": V, "value": 1}).status_code == 200
    assert c.post("/api/feedback/vote", json={"app": "nexus", "visitor": V, "value": -1}).status_code == 200
    r = c.get("/api/feedback/admin", auth=("admin", "pw")); assert r.status_code == 200
    assert "<td>0</td><td>1</td>" in r.text  # one visitor, one vote: now a thumbs down
    c.post("/api/feedback/vote", json={"app": "nexus", "visitor": V, "value": 0})
    assert "<td>0</td><td>0</td>" in c.get("/api/feedback/admin", auth=("admin", "pw")).text

def test_rejects_unknown_app_and_bad_input(tmp_path, monkeypatch):
    m, c = make(tmp_path, monkeypatch)
    assert c.post("/api/feedback/vote", json={"app": "evil", "visitor": V, "value": 1}).status_code == 400
    assert c.post("/api/feedback/message", json={"app": "nexus", "visitor": V, "kind": "idea", "text": "x" * 3000}).status_code == 422
    assert c.post("/api/feedback/message", json={"app": "nexus", "visitor": V, "kind": "idea", "text": "hi", "email": "a@b.co"}).status_code == 400  # no consent

def test_message_filter_csv_delete(tmp_path, monkeypatch):
    m, c = make(tmp_path, monkeypatch)
    c.post("/api/feedback/message", json={"app": "nexus", "visitor": V, "kind": "idea", "text": "=HYPERLINK(1) add <b>dark</b> mode", "name": "Ann", "email": "ann@x.io", "consent": True}, headers={"cf-ipcountry": "SG"})
    c.post("/api/feedback/message", json={"app": "cerebro", "visitor": V, "kind": "feedback", "text": "nice"})
    assert c.get("/api/feedback/admin").status_code == 401
    page = c.get("/api/feedback/admin?app_=nexus", auth=("admin", "pw")).text
    assert "&lt;b&gt;dark&lt;/b&gt;" in page and "nice" not in page and ">SG<" in page
    csv = c.get("/api/feedback/admin.csv?app_=nexus", auth=("admin", "pw")).text
    assert "'=HYPERLINK" in csv and "ann@x.io" in csv
    assert c.post("/api/feedback/admin/delete", content="id=1", auth=("admin", "pw"), headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert c.post("/api/feedback/admin/delete", content="id=1", auth=("admin", "pw"), follow_redirects=False).status_code == 303
    assert "HYPERLINK" not in c.get("/api/feedback/admin", auth=("admin", "pw")).text

def test_honeypot_and_rate_limit(tmp_path, monkeypatch):
    m, c = make(tmp_path, monkeypatch)
    assert c.post("/api/feedback/message", json={"app": "nexus", "visitor": V, "kind": "idea", "text": "spam", "website": "x"}).json() == {"ok": True}
    codes = [c.post("/api/feedback/message", json={"app": "nexus", "visitor": V, "kind": "idea", "text": f"n{i}"}).status_code for i in range(12)]
    assert codes.count(200) == 10 and codes[-1] == 429
    assert "spam" not in c.get("/api/feedback/admin", auth=("admin", "pw")).text
