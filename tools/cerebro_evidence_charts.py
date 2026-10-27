"""Derive the CEREBRO evaluation page's chart data from the evaluation's evidence archives.

    python tools/cerebro_evidence_charts.py <deployed.tar.gz> <designed.tar.gz> pages/cerebro-ml.charts.json

The archives are what CEREBRO's `evaluation/run.sh` writes on Buddy: one run with the models the
live deployment uses ("deployed": llama3.2 and the hashing embedder, because its Ollama has no
embedding model) and one with the models it is configured for ("designed": qwen3 and
mxbai-embed-large, in a separate Ollama). Every file is checked against the run's manifest before
anything is read, and the archives' own SHA-256 is recorded in the output.

One number is computed here rather than read: how often a reply says the passages lack the answer.
The product's own check (`_abstained` in backend/app/services/recall.py) looks for a handful of
exact phrases and misses common ones ("do not specify", "there is no mention"), so the page shows
both — the product's count and this rule's — and the rule is printed with them.
"""

import hashlib
import io
import json
import re
import sys
import tarfile
from pathlib import Path

deployed_tar, designed_tar, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])

# A reply that states the passages lack the information. Matched on the first sentence for
# "declines", anywhere for "flags missing information".
MISSING = re.compile(
    r"\b(do(es)? not|don't|doesn't|did not|is not|are not|isn't|aren't|no)\s+"
    r"(specif\w*|mention\w*|provide\w*|contain\w*|state\w*|say|include\w*|indicate\w*|discuss\w*"
    r"|address\w*|give\w*|offer\w*|detail\w*)"
    r"|\bnot (mentioned|specified|stated|provided|given|included|discussed|addressed)"
    r"|\bno (mention|information|specific information|details?|data|indication|reference)\b"
    r"|\bcannot (be )?(determine|answer|find)|\bunable to (determine|answer|find)"
    r"|\bnot (possible|able) to (determine|say|answer)|\binsufficient\b",
    re.IGNORECASE,
)

READABLE = {
    "alt.atheism": "Atheism", "comp.graphics": "Computer graphics", "comp.os.ms-windows.misc": "MS Windows",
    "comp.sys.ibm.pc.hardware": "PC hardware", "comp.sys.mac.hardware": "Mac hardware",
    "comp.windows.x": "X Window", "misc.forsale": "For sale", "rec.autos": "Cars",
    "rec.motorcycles": "Motorcycles", "rec.sport.baseball": "Baseball", "rec.sport.hockey": "Hockey",
    "sci.crypt": "Cryptography", "sci.electronics": "Electronics", "sci.med": "Medicine", "sci.space": "Space",
    "soc.religion.christian": "Christianity", "talk.politics.guns": "Gun politics",
    "talk.politics.mideast": "Mideast politics", "talk.politics.misc": "Politics (other)",
    "talk.religion.misc": "Religion (other)",
}
# Three groups and "Other": a scatter can carry three categorical colours legibly, not twenty.
GROUP = {
    "comp": "Computers", "rec": "Recreation and sport", "talk": "Religion and politics",
    "alt": "Religion and politics", "soc": "Religion and politics",
}
SYSTEMS = {
    "keyword": "Keyword (Postgres, as shipped)", "bm25": "BM25 keyword (reference)",
    "hashing": "Hashing embedder (fallback)", "semantic": "mxbai-embed-large",
    "hybrid": "Hybrid: keyword + embeddings (as shipped)", "hybrid_bm25": "Hybrid: BM25 + embeddings",
}
MODELS = {
    "neural_head_semantic": "Neural head (PyTorch) · mxbai", "knn_semantic": "k-NN · mxbai",
    "logreg_semantic": "Logistic regression · mxbai", "random_forest_semantic": "Random forest · mxbai",
    "nearest_centroid_semantic": "Nearest centroid · mxbai (no training)",
    "linear_svm_tfidf": "Linear SVM · TF-IDF", "logreg_tfidf": "Logistic regression · TF-IDF",
    "random_forest_tfidf": "Random forest · TF-IDF", "llm_zero_shot": "qwen3, no training",
    "logreg_hashing": "Logistic regression · hashing", "neural_head_hashing": "Neural head · hashing",
    "random_forest_hashing": "Random forest · hashing", "nearest_centroid_hashing": "Nearest centroid · hashing",
    "knn_hashing": "k-NN · hashing",
}


def load(archive: Path) -> tuple[dict, str]:
    """Every file of one run, verified against its manifest."""
    files = {}
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if member.isfile():
                files[member.name.split("/", 1)[1]] = tar.extractfile(member).read()
    manifest = json.loads(files["manifest.json"])
    for entry in manifest["files"]:
        if hashlib.sha256(files[entry["path"]]).hexdigest() != entry["sha256"]:
            raise SystemExit(f"{archive.name}: {entry['path']} does not match its manifest")
    run = {name: json.loads(body) for name, body in files.items() if name.endswith(".json")}
    run["answers"] = [json.loads(line) for line in io.BytesIO(files["grounded/answers.jsonl"])]
    return run, hashlib.sha256(archive.read_bytes()).hexdigest()


dep, dep_sha = load(deployed_tar)
des, des_sha = load(designed_tar)
r4 = lambda v: None if v is None else round(v, 4)  # noqa: E731


def ci(m: dict) -> str:
    return f"{m['ci95'][0]:.3f}–{m['ci95'][1]:.3f}"


def thin(hist: dict, factor: int = 2) -> tuple[list[float], list[int]]:
    edges, counts = hist["edges"], hist["counts"]
    merged = [sum(counts[i:i + factor]) for i in range(0, len(counts), factor)]
    return [edges[i] for i in range(0, len(counts), factor)] + [edges[-1]], merged


data: dict = {"source": {
    "deployed": {"archive": deployed_tar.name, "sha256": dep_sha},
    "designed": {"archive": designed_tar.name, "sha256": des_sha},
}}

# --- Provenance -----------------------------------------------------------------------------
mf_dep, mf_des = dep["manifest.json"], des["manifest.json"]
data["provenance"] = [
    {"item": "CEREBRO commit", "value": mf_des["cerebro_commit"][:12]},
    {"item": "GPU", "value": f"{mf_des['environment']['gpu']} ({mf_des['environment']['gpu_memory_gb']} GB)"},
    {"item": "PyTorch · CUDA · Python", "value": f"{mf_des['environment']['torch']} · {mf_des['environment']['cuda']} · {mf_des['environment']['python']}"},
    {"item": "Deployed models", "value": f"{mf_dep['ollama']['chat_model']} ({mf_dep['ollama']['installed'][0]['parameter_size']}, {mf_dep['ollama']['installed'][0]['quantization']}) · hashing embedder"},
    {"item": "Designed models", "value": f"{mf_des['ollama']['chat_model']} · {mf_des['ollama']['embedding_model']}"},
    *[{"item": f"Dataset · {d['name']}", "value": f"SHA-256 {d['sha256'][:16]}…"} for d in mf_des["datasets"]],
    {"item": "Neural head checkpoint", "value": f"SHA-256 {des['topics/classifiers.json']['results']['neural_head_semantic']['training']['checkpoint_sha256'][:16]}…"},
    {"item": "Evidence · deployed run", "value": f"SHA-256 {dep_sha[:16]}…"},
    {"item": "Evidence · designed run", "value": f"SHA-256 {des_sha[:16]}…"},
]

# --- Data engineering -------------------------------------------------------------------------
audit = des["topics/data_profile.json"]["audit"]
data["audit"] = [
    {"step": "Posts as published (by date)", "train": audit["raw"]["train"], "test": audit["raw"]["test"]},
    {"step": "Empty once headers, signatures and quotes are removed", "train": -audit["empty_after_cleaning"]["train"], "test": -audit["empty_after_cleaning"]["test"]},
    {"step": "Exact duplicates within a split", "train": -audit["exact_duplicates_within"]["train"], "test": -audit["exact_duplicates_within"]["test"]},
    {"step": "Exact duplicates of a training post", "train": 0, "test": -audit["exact_duplicates_across_split"]},
    {"step": "Near-duplicates of a training post (cosine ≥ 0.95)", "train": 0, "test": -audit["near_duplicates_across_split"]},
    {"step": "Used", "train": audit["after_cleaning"]["train"], "test": audit["test_after_dedup"]},
]
rp = des["retrieval/data_profile.json"]
edges, counts = thin(rp["fragment_chars_histogram"], 2)
data["fragments"] = [{"range": f"{int(edges[i])}–{int(edges[i + 1])}", "fragments": c} for i, c in enumerate(counts) if c]
data["chunking"] = {
    "documents": rp["documents"], "fragments": rp["fragments"],
    "per_doc": round(rp["fragments_per_document"]["mean"], 2),
    "chars_p50": rp["fragment_chars"]["p50"], "tokens_p95": rp["fragment_token_estimate"]["p95"],
    "tokens_max": rp["fragment_token_estimate"]["max"], "limit": mf_des["embedders"]["semantic"]["payload_limit_tokens"],
    "posts_over_limit": round(des["topics/data_profile.json"]["share_over_payload_limit"], 4),
    "embed_rate": mf_des["embedders"]["semantic"]["texts_per_second"],
}

# --- Retrieval -----------------------------------------------------------------------------------
sys_des = des["retrieval/summary.json"]["systems"]
order = ["hybrid", "semantic", "hybrid_bm25", "bm25", "hashing", "keyword"]
data["search"] = [
    {"system": SYSTEMS[k], "ndcg": r4(sys_des[k]["ndcg@10"]["value"]), "ci": ci(sys_des[k]["ndcg@10"]),
     "r10": r4(sys_des[k]["recall@10"]["value"]), "r100": r4(sys_des[k]["recall@100"]["value"]),
     "mrr": r4(sys_des[k]["mrr@10"]["value"]), "empty": sys_des[k]["queries_with_no_result"],
     "ms": sys_des[k]["ms_per_query"]}
    for k in order
]
sys_dep = dep["retrieval/summary.json"]["systems"]
data["search_shipped"] = [
    {"metric": label, "deployed": r4(sys_dep["hybrid"][key]["value"]), "designed": r4(sys_des["hybrid"][key]["value"])}
    for label, key in (("nDCG@10", "ndcg@10"), ("Recall@10", "recall@10"), ("Recall@100", "recall@100"), ("MRR@10", "mrr@10"))
]
data["search_tests"] = [
    {"comparison": k, "difference": round(v["mean_difference"], 3),
     "ci": f"{v['ci95'][0]:+.3f} to {v['ci95'][1]:+.3f}", "p": round(v["p_two_sided"], 4)}
    for k, v in des["retrieval/summary.json"]["paired_ndcg@10"].items()
]
vs = des["retrieval/summary.json"]["vector_similarity"]
data["search_roc"] = {
    "auc": {"semantic": round(vs["semantic"]["roc_auc"], 3), "hashing": round(vs["hashing"]["roc_auc"], 3)},
    "series": [{"label": f"mxbai-embed-large (AUC {vs['semantic']['roc_auc']:.3f})", "points": [[p["fpr"], p["tpr"]] for p in vs["semantic"]["roc"]]},
               {"label": f"Hashing embedder (AUC {vs['hashing']['roc_auc']:.3f})", "points": [[p["fpr"], p["tpr"]] for p in vs["hashing"]["roc"]]}],
}


def shares(a: dict, b: dict, factor: int = 2) -> list[dict]:
    ea, ca = thin(a, factor)
    _, cb = thin(b, factor)
    ta, tb = sum(ca) or 1, sum(cb) or 1
    return [{"range": f"{ea[i]:.2f}–{ea[i + 1]:.2f}", "a": round(x / ta, 4), "b": round(y / tb, 4)}
            for i, (x, y) in enumerate(zip(ca, cb, strict=True))]


data["search_hist"] = shares(vs["semantic"]["relevant"], vs["semantic"]["not_relevant"])

# --- Topics: similarity and projection -------------------------------------------------------
sim = des["topics/similarity.json"]
names = des["topics/classifiers.json"]["labels"]
readable = [READABLE.get(n, n) for n in names]
data["topic_hist"] = shares(sim["semantic"]["same_topic"], sim["semantic"]["different_topic"])
data["topic_roc"] = {
    "series": [{"label": f"mxbai-embed-large (AUC {sim['semantic']['roc_auc_same_vs_different']:.3f})", "points": [[p["fpr"], p["tpr"]] for p in sim["semantic"]["roc"]]},
               {"label": f"Hashing embedder (AUC {sim['hashing']['roc_auc_same_vs_different']:.3f})", "points": [[p["fpr"], p["tpr"]] for p in sim["hashing"]["roc"]]}],
}
data["similarity_summary"] = [
    {"space": label, "same": round(sim[k]["same_topic_mean"], 3), "different": round(sim[k]["different_topic_mean"], 3),
     "auc": round(sim[k]["roc_auc_same_vs_different"], 3), "silhouette": round(sim[k]["silhouette_cosine"], 3)}
    for k, label in (("semantic", "mxbai-embed-large"), ("hashing", "Hashing embedder"))
]
rule = sim["semantic"]["galaxy_rule"]
data["centroids"] = {"labels": readable, "matrix": sim["semantic"]["centroid_matrix"],
                     "typical": round(rule["typical"], 3), "threshold": round(rule["threshold"], 3)}
data["galaxy_edges"] = [{"a": READABLE.get(e["a"], e["a"]), "b": READABLE.get(e["b"], e["b"]), "similarity": round(e["similarity"], 3)}
                        for e in rule["edges"]]
proj = des["topics/projection.json"]
group_of = [GROUP.get(n.split(".")[0], "Other") for n in names]
groups = ["Computers", "Recreation and sport", "Religion and politics", "Other"]
data["pca"] = {
    "groups": groups,
    "points": [[round(x, 3), round(y, 3), groups.index(group_of[label])]
               for (x, y), label in zip(proj["pca_dense"]["points"], proj["sample_labels"], strict=True)],
    "variance_2d": round(sum(proj["pca_dense"]["explained_variance"][:2]), 4),
    "silhouette_2d": round(proj["pca_dense"]["silhouette_2d"], 3),
}
data["pca_groups"] = [{"group": g, "posts": sum(1 for p in data["pca"]["points"] if p[2] == i),
                       "topics": ", ".join(readable[j] for j, n in enumerate(names) if group_of[j] == g)}
                      for i, g in enumerate(groups)]
pv, sv = proj["pca_dense"]["explained_variance"], proj["svd_tfidf"]["explained_variance"]
cum = lambda xs, n: round(sum(xs[:n]), 4)  # noqa: E731
data["variance"] = [{"components": n, "pca": cum(pv, n), "svd": cum(sv, n)} for n in (2, 5, 10, 20, 50)]

# --- Topics: classification ----------------------------------------------------------------------
res = des["topics/classifiers.json"]["results"]
ranked = sorted((k for k in res if k in MODELS), key=lambda k: -res[k]["macro_f1"]["value"])
data["classifiers"] = [
    {"model": MODELS[k], "f1": r4(res[k]["macro_f1"]["value"]), "f1_ci": ci(res[k]["macro_f1"]),
     "accuracy": r4(res[k]["accuracy"]["value"]), "accuracy_ci": ci(res[k]["accuracy"]),
     "ece": r4(res[k].get("calibration", {}).get("ece")), "seconds": res[k].get("fit_seconds")}
    for k in ranked
]
head = res["neural_head_semantic"]
data["head"] = head["training"]
data["curve"] = [{"epoch": c["epoch"], "train_loss": r4(c["train_loss"]), "val_loss": r4(c["val_loss"]),
                  "train_accuracy": r4(c["train_accuracy"]), "val_accuracy": r4(c["val_accuracy"]),
                  "best": "best (kept)" if c["epoch"] == head["training"]["best_epoch"] else ""}
                 for c in des["topics/training_curve.json"]]
cm = des["topics/confusion.json"]["matrices"]["neural_head_semantic"]
data["confusion"] = {"labels": readable, "matrix": [[round(v / max(1, sum(row)), 4) for v in row] for row in cm],
                     "counts": cm}
pairs = sorted(((cm[i][j], i, j) for i in range(len(cm)) for j in range(len(cm)) if i != j), reverse=True)[:8]
data["confused"] = [{"true": readable[i], "predicted": readable[j], "count": n, "share": round(n / sum(cm[i]), 4)}
                    for n, i, j in pairs]
data["per_class"] = sorted(({"topic": READABLE.get(n, n), "f1": r4(v["f1-score"]), "support": v["support"]}
                            for n, v in head["per_class"].items()), key=lambda r: r["f1"])
data["calibration"] = [{"bin": f"{b['lo']:.0%}–{b['hi']:.0%}", "confidence": r4(b["confidence"]),
                        "accuracy": r4(b["accuracy"]), "samples": b["count"]}
                       for b in head["calibration"]["bins"] if b["count"] >= 20]
data["forest_words"] = [{"word": w["word"], "importance": round(w["importance"], 5)} for w in des["topics/forest_top_words.json"][:15]]
zs_dep, zs_des = dep["topics/classifiers.json"]["results"]["llm_zero_shot"], res["llm_zero_shot"]
data["llm_topics"] = [
    {"model": f"{mf_dep['ollama']['chat_model']} (deployed)", "accuracy": r4(zs_dep["accuracy"]["value"]),
     "f1": r4(zs_dep["macro_f1"]["value"]), "unusable": zs_dep["unusable_replies"], "sample": zs_dep["sample"],
     "p50_ms": zs_dep["latency_ms"]["p50"]},
    {"model": f"{mf_des['ollama']['chat_model']} (designed)", "accuracy": r4(zs_des["accuracy"]["value"]),
     "f1": r4(zs_des["macro_f1"]["value"]), "unusable": zs_des["unusable_replies"], "sample": zs_des["sample"],
     "p50_ms": zs_des["latency_ms"]["p50"]},
]

# --- Grounded answering ---------------------------------------------------------------------------


def answering(run: dict) -> dict:
    s = run["grounded/summary.json"]
    una = [r for r in run["answers"] if not r["answerable"]]
    ans = [r for r in run["answers"] if r["answerable"]]
    first = lambda r: bool(MISSING.search(re.split(r"(?<=[.!?])\s", r["answer"], maxsplit=1)[0]))  # noqa: E731
    return {
        "model": s["model"], "questions": len(run["answers"]),
        "contains": r4(s["answerable"]["contains_gold_answer"]["value"]), "contains_ci": ci(s["answerable"]["contains_gold_answer"]),
        "word_recall": r4(s["answerable"]["answer_word_recall"]["value"]),
        "squad_f1": r4(s["answerable"]["squad_f1"]["value"]),
        "cites": r4(s["citations"]["answers_with_a_citation"]["value"]),
        "cites_right": r4(s["citations"]["cites_the_answer_paragraph"]["value"]),
        "invalid": s["citations"]["replies_with_invalid_citations_removed"],
        "product_declined": sum(r["declined"] for r in una), "declined_first": sum(first(r) for r in una),
        "flagged_any": sum(bool(MISSING.search(r["answer"])) for r in una),
        "answerable_flagged": sum(bool(MISSING.search(r["answer"])) for r in ans),
        "unanswerable": len(una), "answerable": len(ans),
        "p50_ms": s["cost"]["latency_ms"]["p50"], "p95_ms": s["cost"]["latency_ms"]["p95"],
        "tok_s": round(s["cost"]["completion_tokens_per_second"]["p50"], 1),
        "completion": s["cost"]["completion_tokens"]["p50"],
        "prompt_at_4096": sum(1 for r in run["answers"] if (r["prompt_tokens"] or 0) >= 4096),
    }


g_dep, g_des = answering(dep), answering(des)
data["answering"] = [g_dep, g_des]
data["answer_compare"] = [
    {"metric": label, "deployed": g_dep[key], "designed": g_des[key]}
    for label, key in (("Reply contains the answer", "contains"), ("Reply cites a passage", "cites"),
                       ("Cites the paragraph holding the answer", "cites_right"))
]
data["abstention"] = [
    {"measure": "Declines in its first sentence", "deployed": g_dep["declined_first"], "designed": g_des["declined_first"]},
    {"measure": "Says the information is missing, anywhere", "deployed": g_dep["flagged_any"], "designed": g_des["flagged_any"]},
    {"measure": "Flagged by CEREBRO's own check", "deployed": g_dep["product_declined"], "designed": g_des["product_declined"]},
]

out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {out}: {len(data)} datasets")
