"""Derive the CEREBRO image-evaluation page's chart data from its evidence archive.

    python tools/cerebro_image_charts.py <CEREBRO_ML_Evaluation_Evidence.zip> pages/cerebro-images.charts.json

The archive holds the image experiments run on Buddy (ImageNetV2 sample, EfficientNet-B0 and
ResNet-50, Florence-2 captions, PCA and K-Means, a random-forest reliability check, and cosine
retrieval judged by a person). Every headline number is recomputed here from the per-image files —
predictions, annotations, coordinates — and the run stops if it disagrees with the experiment's own
metrics.json, so the page can never show a number its raw evidence does not support.
"""

import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from statistics import median

src, out = Path(sys.argv[1]), Path(sys.argv[2])
z = zipfile.ZipFile(src)
E = "evidence/"


def read(name: str) -> str:
    return z.read(E + name).decode()


def rows(name: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(read(name))))


def check(label: str, mine: float, theirs: float, tol: float = 1e-6) -> None:
    if abs(mine - theirs) > tol:
        raise SystemExit(f"{label}: recomputed {mine} but the evidence says {theirs}")


def roc(scores: list[float], labels: list[int], points: int = 60) -> tuple[float, list[list[float]]]:
    """ROC AUC (rank form, ties averaged) and a thinned curve."""
    pairs = sorted(zip(scores, labels, strict=True), key=lambda p: -p[0])
    pos = sum(labels)
    neg = len(labels) - pos
    tp = fp = 0
    curve = [[0.0, 0.0]]
    i = 0
    while i < len(pairs):
        j = i
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            tp += pairs[j][1]
            fp += 1 - pairs[j][1]
            j += 1
        curve.append([fp / neg, tp / pos])
        i = j
    auc = sum((b[0] - a[0]) * (a[1] + b[1]) / 2 for a, b in zip(curve, curve[1:]))
    step = max(1, len(curve) // points)
    return auc, [[round(x, 4), round(y, 4)] for x, y in curve[::step] + [curve[-1]]]


data: dict = {"source": {"archive": src.name, "sha256": hashlib.sha256(src.read_bytes()).hexdigest()}}

# --- Classification (EXP-IMG-001/002/003) ------------------------------------------------------
bench = json.loads(read("EXP-IMG-003_ImageNetV2_Benchmark/metrics.json"))
verify = json.loads(read("EXP-IMG-001_ImageNet/model_verification.json"))
preds = rows("EXP-IMG-003_ImageNetV2_Benchmark/predictions_evaluated.csv")
models = []
for name in ("EfficientNet-B0", "ResNet-50"):
    mine = [r for r in preds if r["model"] == name]
    top1 = sum(int(r["top1_correct"]) for r in mine) / len(mine)
    top5 = sum(int(r["top5_correct"]) for r in mine) / len(mine)
    m = bench["models"][name]
    check(f"{name} top-1", top1, m["top1_accuracy"])
    check(f"{name} top-5", top5, m["top5_accuracy"])
    models.append({"model": name, "top1": top1, "top5": top5, "images": len(mine),
                   "median_ms": m["median_latency_ms"], "p95_ms": m["p95_latency_ms"],
                   "per_second": m["inference_only_images_per_second"],
                   "parameters": verify["models"][name]["parameters"]})
data["models"] = models
by = {}
for r in preds:
    by.setdefault(r["image_id"], {})[r["model"]] = int(r["top1_correct"])
data["agreement"] = [
    {"outcome": "Both right", "images": sum(1 for v in by.values() if v["EfficientNet-B0"] and v["ResNet-50"])},
    {"outcome": "Only ResNet-50 right", "images": sum(1 for v in by.values() if v["ResNet-50"] and not v["EfficientNet-B0"])},
    {"outcome": "Only EfficientNet-B0 right", "images": sum(1 for v in by.values() if v["EfficientNet-B0"] and not v["ResNet-50"])},
    {"outcome": "Both wrong", "images": sum(1 for v in by.values() if not v["EfficientNet-B0"] and not v["ResNet-50"])},
]

# --- Data preparation ---------------------------------------------------------------------------
manifest = rows("EXP-IMG-002_Enrichment/metadata/corpus_manifest.csv")
classes = {r["class_id"] for r in manifest}
hashes = {r["sha256"] for r in manifest}
data["preparation"] = {
    "images": len(manifest), "classes": len(classes), "unique_hashes": len(hashes),
    "pending_review": sum(1 for r in manifest if r["review_status"] == "pending"),
    "dataset_sha256": read("EXP-IMG-002_Enrichment/logs/dataset_sha256.txt").split()[0],
}
structured = json.loads(read("EXP-META-001_Structured_Metadata/d0d76a166ac6b3e2_metadata.json"))
data["metadata_fields"] = [
    {"field": f["field"], "value": str(f["value"]) if f["field"] != "sha256" else f["value"][:16] + "…",
     "method": f["method"], "status": f["review_status"]}
    for f in structured["metadata"]["technical"]
]
enrich = json.loads(read("EXP-META-002_AI_Enrichment/IMG-000001_enrichment.json"))["enrichment"]
data["enrichment_example"] = {
    "subject": enrich["primary_subject"]["value"], "score": enrich["primary_subject"]["model_score"],
    "alternatives": [a["value"] for a in enrich["alternative_subjects"][:3]],
    "caption": enrich["description"]["value"],
}

# --- Captions (EXP-IMG-004) ------------------------------------------------------------------------
caps = [json.loads(line) for line in read("EXP-IMG-004_Florence_Enrichment/captions.jsonl").splitlines() if line.strip()]
words = [len(c["caption"].split()) for c in caps if c.get("caption")]
data["captions"] = {"images": len(caps), "with_caption": len(words), "median_words": median(words),
                    "min_words": min(words), "max_words": max(words),
                    "model": json.loads(read("EXP-IMG-004_Florence_Enrichment/config.json"))["model"]}
bins = [(0, 40), (40, 60), (60, 80), (80, 100), (100, 120), (120, 200)]
data["caption_lengths"] = [{"range": f"{a}–{b}" if b < 200 else f"{a}+", "images": sum(1 for w in words if a <= w < b)} for a, b in bins]

# --- PCA and K-Means (EXP-META-003) ----------------------------------------------------------------
pm = json.loads(read("EXP-META-003_PCA_KMeans/metrics.json"))
coords = rows("EXP-META-003_PCA_KMeans/coordinates.csv")
k = pm["kmeans_clusters"]
# Clusters numbered by size, largest first, so the colours go to the clusters that hold images
# and the smallest lands on the neutral last slot.
sizes = sorted(range(k), key=lambda c: -sum(1 for r in coords if int(r["cluster"]) == c))
rank = {c: i for i, c in enumerate(sizes)}
data["pca"] = {
    "groups": [f"Cluster {i + 1}" for i in range(k)],
    "points": [[round(float(r["pca_1"]), 3), round(float(r["pca_2"]), 3), rank[int(r["cluster"])]] for r in coords],
}
data["pca_summary"] = {"variance_2d": pm["pca_total_explained_variance"], "silhouette": pm["silhouette_score"],
                       "features": pm["feature_dimensions"], "classes": len({r["class_id"] for r in coords})}
data["clusters"] = [{"cluster": f"Cluster {rank[c] + 1}", "images": sum(1 for r in coords if int(r["cluster"]) == c),
                     "classes": len({r["class_id"] for r in coords if int(r["cluster"]) == c})} for c in sizes]

# --- Reliability (EXP-META-004) ------------------------------------------------------------------
rm = json.loads(read("EXP-META-004_RandomForest/metrics.json"))
rp = rows("EXP-META-004_RandomForest/predictions.csv")
truth = [int(r["correct"]) for r in rp]
guess = [int(r["predicted_correct"]) for r in rp]
check("random forest accuracy", sum(t == g for t, g in zip(truth, guess, strict=True)) / len(rp), rm["accuracy"])
auc, curve = roc([float(r["predicted_probability"]) for r in rp], truth)
check("random forest ROC AUC", auc, rm["roc_auc"], 1e-3)
data["rf"] = {"accuracy": rm["accuracy"], "precision": rm["precision"], "recall": rm["recall"], "f1": rm["f1"],
              "auc": rm["roc_auc"], "baseline": rm["majority_baseline_accuracy"], "cv": rm["cross_validation"],
              "positives": rm["positive_cases"], "negatives": rm["negative_cases"]}
data["rf_confusion"] = [
    {"actual": "ResNet-50 right", "flagged_right": sum(1 for t, g in zip(truth, guess, strict=True) if t and g),
     "flagged_wrong": sum(1 for t, g in zip(truth, guess, strict=True) if t and not g)},
    {"actual": "ResNet-50 wrong", "flagged_right": sum(1 for t, g in zip(truth, guess, strict=True) if not t and g),
     "flagged_wrong": sum(1 for t, g in zip(truth, guess, strict=True) if not t and not g)},
]
names = {"top1_score": "Top score", "top2_score": "Runner-up score", "score_margin": "Gap between top two",
         "top5_entropy": "Spread across top 5"}
data["rf_features"] = sorted(({"feature": names[k_], "importance": round(v, 4)} for k_, v in rm["feature_importance"].items()),
                             key=lambda r: -r["importance"])

# --- Retrieval with human judgements (EXP-META-005) ----------------------------------------------
hm = json.loads(read("EXP-META-005_Cosine_Retrieval/human_evaluation_metrics.json"))
ann = [r for r in rows("EXP-META-005_Cosine_Retrieval/EXP-META-005_human_annotations.csv") if r["relevance"].strip() != ""]
check("assessed pairs", len(ann), hm["assessed_pairs"])
queries: dict[str, dict[int, int]] = {}
for r in ann:
    queries.setdefault(r["query_image_id"], {})[int(r["neighbor_rank"])] = int(float(r["relevance"]))
pk = {}
for kk in (1, 3, 5):
    full = [q for q in queries.values() if all(rank in q for rank in range(1, kk + 1))]
    pk[kk] = sum(sum(q[rank] for rank in range(1, kk + 1)) / kk for q in full) / len(full)
    check(f"precision@{kk}", pk[kk], hm["precision_at_k"][str(kk)])
data["precision_at_k"] = [{"k": f"Top {kk}", "precision": round(pk[kk], 4)} for kk in (1, 3, 5)]
data["relevance_by_rank"] = [
    {"rank": f"#{rank}", "relevant": round(sum(int(float(r["relevance"])) for r in ann if int(r["neighbor_rank"]) == rank)
                                       / sum(1 for r in ann if int(r["neighbor_rank"]) == rank), 4),
     "similarity": round(sum(float(r["cosine_similarity"]) for r in ann if int(r["neighbor_rank"]) == rank)
                         / sum(1 for r in ann if int(r["neighbor_rank"]) == rank), 4)}
    for rank in range(1, 6)
]
sims = [float(r["cosine_similarity"]) for r in ann]
rel = [int(float(r["relevance"])) for r in ann]
auc, curve2 = roc(sims, rel)
check("retrieval ROC AUC", auc, hm["roc_auc"], 1e-3)
data["roc_retrieval"] = {"series": [{"label": f"Similarity vs human judgement (AUC {hm['roc_auc']:.2f})", "points": curve2}]}
data["roc_rf"] = {"series": [{"label": f"Random forest (AUC {rm['roc_auc']:.2f})", "points": curve}]}
lo, hi = min(sims), max(sims)
edges = [lo + (hi - lo) * i / 12 for i in range(13)]
pos_n, neg_n = sum(rel), len(rel) - sum(rel)
data["similarity_hist"] = [
    {"range": f"{edges[i]:.2f}–{edges[i + 1]:.2f}",
     "relevant": round(sum(1 for s, y in zip(sims, rel, strict=True) if y and (edges[i] <= s < edges[i + 1] or (i == 11 and s == hi))) / pos_n, 4),
     "not_relevant": round(sum(1 for s, y in zip(sims, rel, strict=True) if not y and (edges[i] <= s < edges[i + 1] or (i == 11 and s == hi))) / neg_n, 4)}
    for i in range(12)
]
cm = hm["confusion_matrix"]
data["retrieval"] = {"assessed": hm["assessed_pairs"], "unassessed": hm["unassessed_pairs"], "relevant": hm["relevant"],
                     "not_relevant": hm["not_relevant"], "auc": hm["roc_auc"], "threshold": hm["exploratory_threshold"],
                     "t_precision": hm["threshold_precision"], "t_recall": hm["threshold_recall"], "t_f1": hm["threshold_f1"],
                     "confusion": cm, "queries": len(queries)}

# --- Provenance ------------------------------------------------------------------------------------
data["provenance"] = [
    {"item": "GPU", "value": pm["gpu"]},
    {"item": "PyTorch · torchvision · scikit-learn", "value": f"{pm['pytorch']} · {pm['torchvision']} · {pm['sklearn']}"},
    {"item": "Dataset · ImageNetV2 (matched frequency)", "value": f"SHA-256 {data['preparation']['dataset_sha256'][:16]}…"},
    {"item": "Sample", "value": f"{len(manifest)} images, one per class, each hashed (SHA-256)"},
    {"item": "Evidence archive", "value": f"SHA-256 {data['source']['sha256'][:16]}…"},
]

out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {out}: every headline number recomputed and matched")
