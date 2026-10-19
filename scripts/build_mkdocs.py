"""扫描 papers/YYYYMM 目录，按 frontmatter 生成 docs/ 和 mkdocs.yml。"""

from __future__ import annotations

import os
import re
import shutil
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
TOPICS_FILE = ROOT / "topics.json"
MONTH_RE = re.compile(r"^\d{6}$")
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)


def load_topics() -> list[str]:
    data = yaml.safe_load(TOPICS_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(item, str) for item in data):
        raise SystemExit("topics.json 必须是字符串数组")
    return data


def parse_frontmatter(text: str) -> tuple[dict, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta = yaml.safe_load(match.group(1)) or {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, text[match.end() :]


def heading(body: str, fallback: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def discover(topics: list[str]) -> list[dict]:
    entries = []
    papers = ROOT / "papers"
    if not papers.is_dir():
        return entries
    for month_dir in sorted(path for path in papers.iterdir() if path.is_dir() and MONTH_RE.fullmatch(path.name)):
        for md in sorted(month_dir.glob("*.md")):
            meta, body = parse_frontmatter(md.read_text(encoding="utf-8"))
            title = str(meta.get("title") or heading(body, md.stem))
            topic = str(meta.get("topic") or "其他")
            if topic not in topics:
                topic = "其他"
            date = str(meta.get("date") or "")
            entries.append(
                {
                    "month": month_dir.name,
                    "file": f"papers/{month_dir.name}/{md.name}",
                    "title": title,
                    "topic": topic,
                    "date": date,
                }
            )
    return entries


def month_label(month: str) -> str:
    return f"{month[:4]} 年 {int(month[4:])} 月"


MATHJAX = """\
window.MathJax = {
  tex: { inlineMath: [["$", "$"], ["\\\\(", "\\\\)"]] },
  options: { processHtmlClass: "arithmatex", ignoreHtmlClass: ".*" }
};
var script = document.createElement("script");
script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
script.async = true;
document.head.appendChild(script);
"""


def write_index(entries: list[dict]) -> None:
    lines = [
        "# AI Paper Analysis",
        "",
        "具身智能方向的论文中文解读。新文章放进 `papers/YYYYMM/`，月份是论文在 arXiv 的第一版挂载日期。",
        "",
        "| 日期 | 主题 | 文章 |",
        "|---|---|---|",
    ]
    ordered = sorted(entries, key=lambda item: (item["date"], item["file"]), reverse=True)
    for item in ordered:
        lines.append(f"| {item['date']} | {item['topic']} | [{item['title']}]({item['file']}) |")
    lines.append("")
    (DOCS / "index.md").write_text("\n".join(lines), encoding="utf-8")
    script_dir = DOCS / "javascripts"
    script_dir.mkdir(parents=True, exist_ok=True)
    (script_dir / "mathjax.js").write_text(MATHJAX, encoding="utf-8")


def sync_articles(entries: list[dict]) -> None:
    if DOCS.exists():
        shutil.rmtree(DOCS)
    DOCS.mkdir()
    for item in entries:
        src = ROOT / item["file"]
        dst = DOCS / item["file"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)


def site_url() -> str | None:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        return None
    user, name = repo.split("/", 1)
    return f"https://{user}.github.io/{name}/"


def build_nav(entries: list[dict], topics: list[str]) -> list:
    nav: list = [{"首页": "index.md"}]
    by_topic: dict[str, list[dict]] = defaultdict(list)
    by_month: dict[str, list[dict]] = defaultdict(list)
    for item in entries:
        by_topic[item["topic"]].append(item)
        by_month[item["month"]].append(item)

    topic_section = []
    for topic in topics:
        items = sorted(by_topic.get(topic, []), key=lambda item: item["date"], reverse=True)
        if not items:
            continue
        topic_section.append({f"{topic} ({len(items)})": [{item["title"]: item["file"]} for item in items]})
    if topic_section:
        nav.append({"按主题": topic_section})

    for month in sorted(by_month, reverse=True):
        items = sorted(by_month[month], key=lambda item: item["date"], reverse=True)
        nav.append({month_label(month): [{item["title"]: item["file"]} for item in items]})
    return nav


def main() -> None:
    topics = load_topics()
    entries = discover(topics)
    sync_articles(entries)
    write_index(entries)
    config = {
        "site_name": "AI Paper Analysis",
        "site_description": "具身智能论文中文解读",
        "docs_dir": "docs",
        "site_dir": "site",
        "theme": {
            "name": "readthedocs",
            "highlightjs": False,
            "navigation_depth": 2,
            "collapse_navigation": True,
            "titles_only": True,
            "prev_next_buttons_location": "both",
        },
        "markdown_extensions": [
            "admonition",
            "footnotes",
            "tables",
            "attr_list",
            "toc",
            "pymdownx.superfences",
            "pymdownx.details",
            {"pymdownx.arithmatex": {"generic": True}},
        ],
        "extra_javascript": ["javascripts/mathjax.js"],
        "plugins": [{"search": {"lang": ["en", "zh"]}}],
        "nav": build_nav(entries, topics),
    }
    url = site_url()
    if url:
        config["site_url"] = url
    (ROOT / "mkdocs.yml").write_text(
        yaml.safe_dump(config, allow_unicode=True, sort_keys=False, width=200),
        encoding="utf-8",
    )
    print(f"已生成 {len(entries)} 篇文章")


if __name__ == "__main__":
    main()
