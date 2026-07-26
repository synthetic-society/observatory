"""Build a file that links IPUMS location numbers to region names."""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "resources" / "geolevel1.pdf"
OUT = ROOT / "resources" / "geolev1_labels.json"

# Match one PDF row and capture its region name and number.
ROW = re.compile(r"^(?P<country>.+?)\s{2,}(?P<label>.+?)\s{2,}(?P<code>\d{4,9})\s*$")


def extract_text(pdf: Path) -> str:
    return subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def parse(text: str) -> dict[str, str]:
    labels: dict[str, str] = {}
    for line in text.splitlines():
        if not (match := ROW.match(line)):
            continue
        label = match["label"].strip()
        code = match["code"]
        if label.lower() in {"not identified", "niu"}:
            label = "Unknown"  # IPUMS writes "Not identified" or "NIU"; the site says "Unknown".
        labels[code] = label
    return labels


def main() -> None:
    if not PDF.exists():
        print(f"ERROR: {PDF} not found", file=sys.stderr)
        raise SystemExit(2)
    labels = parse(extract_text(PDF))
    OUT.write_text(json.dumps(labels, ensure_ascii=False, indent=2))
    print(f"wrote {len(labels)} GEOLEV1 labels → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
