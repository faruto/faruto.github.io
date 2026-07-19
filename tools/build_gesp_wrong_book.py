#!/usr/bin/env python3
"""Extract and validate screenshot-based GESP wrong-book data.

The current Word source is image-based, so extraction deliberately stops at a
review package. New or changed screenshots must be transcribed and checked
before they are copied into the public question bank.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def json_dump(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def image_order(zf: zipfile.ZipFile) -> list[str]:
    """Return media paths in the order they occur in document.xml."""
    document = ET.fromstring(zf.read("word/document.xml"))
    rels = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
    rel_targets = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in rels.findall("pr:Relationship", NS)
    }
    ordered: list[str] = []
    for blip in document.findall(".//a:blip", NS):
        rel_id = blip.attrib.get(f"{{{NS['r']}}}embed")
        target = rel_targets.get(rel_id, "")
        if target.startswith("media/"):
            ordered.append("word/" + target)
    return ordered


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def find_latest(source_dir: Path, level: int) -> Path:
    pattern = re.compile(rf"^GESP错题本-{level}级-(\d{{6}})\.docx$")
    candidates = []
    for path in source_dir.glob("*.docx"):
        match = pattern.match(path.name)
        if match:
            candidates.append((match.group(1), path))
    if not candidates:
        raise FileNotFoundError(f"未找到 GESP错题本-{level}级-YYYYMM.docx")
    return max(candidates, key=lambda item: item[0])[1]


def load_manifest(path: Path | None) -> dict[str, dict]:
    if not path or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {item["sha256"]: item for item in data.get("images", [])}


def extract(args: argparse.Namespace) -> int:
    source = Path(args.source) if args.source else find_latest(Path(args.source_dir), args.level)
    review_dir = Path(args.review_dir)
    old_manifest = load_manifest(Path(args.existing_manifest) if args.existing_manifest else None)
    images_dir = review_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    records = []
    with zipfile.ZipFile(source) as zf:
        names = image_order(zf)
        if not names:
            names = sorted(name for name in zf.namelist() if name.startswith("word/media/image"))
        for index, name in enumerate(names, start=1):
            data = zf.read(name)
            digest = sha256(data)
            filename = f"{index:02d}-{Path(name).name}"
            destination = images_dir / filename
            if not destination.exists() or sha256(destination.read_bytes()) != digest:
                destination.write_bytes(data)
            previous = old_manifest.get(digest)
            records.append({
                "index": index,
                "sourceName": Path(name).name,
                "reviewImage": str(Path("images") / filename),
                "sha256": digest,
                "status": "unchanged" if previous else "new",
                "stableId": previous.get("stableId") if previous else None,
            })
    current_hashes = {item["sha256"] for item in records}
    removed = [item for digest, item in old_manifest.items() if digest not in current_hashes]
    payload = {
        "schemaVersion": 1,
        "level": args.level,
        "source": source.name,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "images": records,
        "removedCandidates": removed,
        "note": "截图型 Word 需要人工/视觉转写；status=changed 或 new 的图片必须校对后再 build。",
    }
    json_dump(review_dir / "manifest.json", payload)
    print(json.dumps({"source": str(source), "reviewDir": str(review_dir), "images": len(records), "new": sum(item["status"] == "new" for item in records), "removedCandidates": len(removed)}, ensure_ascii=False))
    return 0


def validate(args: argparse.Namespace) -> int:
    questions = json.loads(Path(args.questions).read_text(encoding="utf-8"))
    answers = json.loads(Path(args.answers).read_text(encoding="utf-8"))
    errors: list[str] = []
    question_items = questions.get("questions", [])
    answer_items = answers.get("answers", [])
    question_ids = [item.get("id") for item in question_items]
    answer_ids = [item.get("id") for item in answer_items]
    if len(question_ids) != len(set(question_ids)):
        errors.append("questions.json 存在重复题目 ID")
    if len(answer_ids) != len(set(answer_ids)):
        errors.append("answers.json 存在重复题目 ID")
    if set(question_ids) != set(answer_ids):
        errors.append("题目 ID 与答案 ID 不完全对应")
    valid_types = {"single-choice", "true-false"}
    for item in question_items:
        if item.get("type") not in valid_types:
            errors.append(f"{item.get('id')}: 题型无效")
        if not item.get("stem"):
            errors.append(f"{item.get('id')}: 缺少题干")
        if item.get("type") == "single-choice":
            options = item.get("options", [])
            if len(options) < 2 or len({option.get("key") for option in options}) != len(options):
                errors.append(f"{item.get('id')}: 选择题选项无效")
        else:
            if item.get("options"):
                errors.append(f"{item.get('id')}: 判断题不应重复定义 options")
    for item in answer_items:
        if not item.get("explanation"):
            errors.append(f"{item.get('id')}: 缺少解析")
        question = next((q for q in question_items if q.get("id") == item.get("id")), None)
        if question and question.get("type") == "single-choice" and item.get("answer") not in {o.get("key") for o in question.get("options", [])}:
            errors.append(f"{item.get('id')}: 选择题答案不在选项中")
        if question and question.get("type") == "true-false" and item.get("answer") not in {"true", "false"}:
            errors.append(f"{item.get('id')}: 判断题答案必须是 true 或 false")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(json.dumps({"valid": True, "questions": len(question_items), "singleChoice": sum(q.get('type') == 'single-choice' for q in question_items), "trueFalse": sum(q.get('type') == 'true-false' for q in question_items)}, ensure_ascii=False))
    return 0


def build(args: argparse.Namespace) -> int:
    result = validate(argparse.Namespace(questions=args.questions, answers=args.answers))
    if result:
        return result
    destination = Path(args.site_data_dir)
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.questions, destination / "questions.json")
    shutil.copy2(args.answers, destination / "answers.json")
    print(json.dumps({"built": str(destination)}, ensure_ascii=False))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="GESP 截图错题本提取、校验和构建工具")
    sub = root.add_subparsers(dest="command", required=True)
    extract_parser = sub.add_parser("extract", help="从 Word 按文档顺序提取截图并生成待校对清单")
    extract_parser.add_argument("--source", help="指定 Word 路径；不填则按级别自动选择最新文件")
    extract_parser.add_argument("--source-dir", default=".")
    extract_parser.add_argument("--level", type=int, required=True)
    extract_parser.add_argument("--review-dir", required=True)
    extract_parser.add_argument("--existing-manifest")
    extract_parser.set_defaults(func=extract)
    validate_parser = sub.add_parser("validate", help="校验题目和答案 JSON")
    validate_parser.add_argument("--questions", required=True)
    validate_parser.add_argument("--answers", required=True)
    validate_parser.set_defaults(func=validate)
    build_parser = sub.add_parser("build", help="校验通过后复制到网站数据目录")
    build_parser.add_argument("--questions", required=True)
    build_parser.add_argument("--answers", required=True)
    build_parser.add_argument("--site-data-dir", required=True)
    build_parser.set_defaults(func=build)
    return root


if __name__ == "__main__":
    parsed_args = parser().parse_args()
    sys.exit(parsed_args.func(parsed_args))
