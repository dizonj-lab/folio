"""Derive the portfolio's chart data from MealSenseAI's training and evaluation evidence.

    python tools/evidence_charts.py <evidence dir> pages/mealsenseai-ml.charts.json

<evidence dir> holds EXP-001_UnifiedFood/ and EXP-002_FineTuning/ as written by the training and
evaluation scripts (on Buddy: ~/development/mealsenseai/evidence). Only the small derived numbers
are committed; the predictions and confusion matrix stay with the evidence.

Per-source macro scores are recomputed here over the classes that source actually contains. The
evaluation's dataset_metrics.json averages over all 320 classes, so a source's absent classes count
as zeros and its macro-F1 reads far too low (Food-101: 0.24); its accuracy and top-3 are unaffected.
"""
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
e1, e2 = src / "EXP-001_UnifiedFood", src / "EXP-002_FineTuning"
ev = e2 / "evaluation"


def history(path, experiment, offset):
    with open(path) as f:
        return [
            {
                "epoch": int(r["epoch"]) + offset,
                "experiment": experiment,
                "train_loss": round(float(r["train_loss"]), 4),
                "val_loss": round(float(r["val_loss"]), 4),
                "train_accuracy": round(float(r["train_accuracy"]), 4),
                "val_accuracy": round(float(r["val_accuracy"]), 4),
                "val_f1_macro": round(float(r["val_f1_macro"]), 4),
            }
            for r in csv.DictReader(f)
        ]


epochs = history(e1 / "training_history.csv", "EXP-001", 0) + history(e2 / "training_history.csv", "EXP-002", 5)
overall = json.loads((ev / "overall_metrics.json").read_text())
calibration = json.loads((ev / "confidence_calibration.json").read_text())
report = json.loads((ev / "classification_report.json").read_text())
cfg1, cfg2 = (json.loads((e / "config.json").read_text()) for e in (e1, e2))
env1 = json.loads((e1 / "environment.json").read_text())

names, by_source, pairs = {}, defaultdict(list), Counter()
with open(ev / "predictions.csv") as f:
    for r in csv.DictReader(f):
        t, p = int(r["true_label_id"]), int(r["predicted_label_id"])
        names[t] = r["canonical_label"]
        by_source[r["dataset"]].append((t, p, r["top3_correct"] == "True"))
        if t != p:
            pairs[(t, p)] += 1


def macro_f1(rows):
    tp, fp, fn = Counter(), Counter(), Counter()
    for t, p, _ in rows:
        if t == p:
            tp[t] += 1
        else:
            fn[t] += 1
            fp[p] += 1
    classes = {t for t, _, _ in rows}
    f1 = [2 * tp[c] / (2 * tp[c] + fp[c] + fn[c]) if tp[c] + fp[c] + fn[c] else 0 for c in classes]
    return sum(f1) / len(f1), len(classes)


sources = []
for name, label in (("Food101", "Food-101"), ("FoodSG233", "FoodSG-233")):
    rows = by_source[name]
    f1, n = macro_f1(rows)
    sources.append({
        "source": label,
        "test_images": len(rows),
        "classes": n,
        "top1": round(sum(t == p for t, p, _ in rows) / len(rows), 4),
        "top3": round(sum(k for *_, k in rows) / len(rows), 4),
        "f1_macro": round(f1, 4),
    })

per_class = [
    {"class": names.get(int(k), k), "f1": round(v["f1-score"], 4), "support": int(v["support"])}
    for k, v in report.items() if k.isdigit()
]
bins = [0] * 10
for c in per_class:
    bins[min(int(c["f1"] * 10), 9)] += 1
per_class.sort(key=lambda c: c["f1"])

total = sum(b["samples"] for b in calibration)
ece = sum(b["samples"] / total * abs(b["actual_accuracy"] - b["mean_confidence"]) for b in calibration)

json.dump({
    "source": "MealSenseAI evidence: EXP-001_UnifiedFood, EXP-002_FineTuning (training_history.csv, evaluation/)",
    "overall": {
        "accuracy": round(overall["accuracy"], 4),
        "top3_accuracy": round(overall["top3_accuracy"], 4),
        "precision_macro": round(overall["precision_macro"], 4),
        "recall_macro": round(overall["recall_macro"], 4),
        "f1_macro": round(overall["f1_macro"], 4),
        "test_images": overall["test_images"],
        "ms_per_image": round(overall["milliseconds_per_image_amortized"], 2),
        "images_per_second": round(overall["images_per_second"]),
        "ece": round(ece, 4),
    },
    "split": {k: env1[k] for k in ("training_images", "validation_images", "test_images_reserved")},
    "experiments": [
        {"id": "EXP-001", "strategy": cfg1["training_strategy"], "epochs": cfg1["epochs"], "lr": str(cfg1["learning_rate"])},
        {"id": "EXP-002", "strategy": cfg2["training_strategy"], "epochs": cfg2["epochs"],
         "lr": f'{cfg2["backbone_learning_rate"]} backbone / {cfg2["classifier_learning_rate"]} classifier',
         "unfrozen_blocks": cfg2["unfrozen_feature_blocks"]},
    ],
    "epochs": epochs,
    "calibration": [
        {"bin": f'{b["bin"] / 10:.1f}–{(b["bin"] + 1) / 10:.1f}', "samples": b["samples"],
         "confidence": round(b["mean_confidence"], 4), "accuracy": round(b["actual_accuracy"], 4)}
        for b in calibration
    ],
    "sources": sources,
    "f1_histogram": [{"range": f"{i / 10:.1f}–{(i + 1) / 10:.1f}", "classes": n} for i, n in enumerate(bins)],
    "weakest": per_class[:8],
    "strongest": per_class[-5:][::-1],
    "confused": [
        {"true": names[t], "predicted": names[p], "count": n,
         "share": round(n / next(c["support"] for c in per_class if c["class"] == names[t]), 4)}
        for (t, p), n in pairs.most_common(8)
    ],
}, open(out, "w"), indent=1, ensure_ascii=False)
print("wrote", out)
