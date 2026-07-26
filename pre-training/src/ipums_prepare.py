"""Clean downloaded IPUMS records and save one set of files per country."""

import json
import time
from collections import defaultdict
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
import tyro
from ipumspy import readers
from ipumspy.ddi import Codebook

from lib_ipums import (
    country_name_to_iso3,
    load_state,
    now_iso,
    parse_sample_id,
    save_state,
    token_to_iso3,
)

ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT / "state" / "extracts.json"
CACHE_ROOT = ROOT / "cache"
OUT_DIR = CACHE_ROOT / "per_country"

# Remove codes that IPUMS uses for missing, unknown, or unusable answers.
DROP_CODES: dict[str, set[int]] = {
    "AGE": {999},
    "SEX": {9},
    "MARST": {0, 9},
    "RELIGION": {0, 9},
    "RACE": {99},
    "EDATTAIN": {0, 9},
    "EMPSTAT": {0, 3, 9},
    "URBAN": {0, 9},
    "CHBORN": {98, 99},
}


def fmt_bytes(n: int) -> str:
    value = float(n)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024:
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} PiB"


def log(msg: str) -> None:
    print(msg, flush=True)


def _atomic_write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _atomic_write_parquet(df: pd.DataFrame, path: Path) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)


def country_outputs_complete(iso3: str) -> bool:
    """Return whether all three output files exist for a country."""
    return all((OUT_DIR / f"{iso3}{suffix}").exists() for suffix in (".parquet", ".labels.json", ".meta.json"))


def _meta_n_persons(iso3: str) -> int:
    try:
        return int(json.loads((OUT_DIR / f"{iso3}.meta.json").read_text())["n_persons"])
    except (OSError, KeyError, TypeError, ValueError):
        return 0


def batch_iso3_set(samples: list[str], only_iso3: set[str] | None) -> set[str]:
    """Return the country codes expected in this batch."""
    iso3s = {iso3 for sid in samples if (sk := parse_sample_id(sid)) and (iso3 := token_to_iso3(sk.country_token))}
    return iso3s & only_iso3 if only_iso3 is not None else iso3s


def apply_filters(df: pd.DataFrame) -> pd.DataFrame:
    for col, bad in DROP_CODES.items():
        if col in df.columns:
            df = df[~df[col].isin(bad)]
    return df


def country_code_to_iso3_map(ddi: Codebook) -> dict[int, str]:
    """Map each IPUMS country number to its three-letter country code."""
    try:
        vd = ddi.get_variable_info("COUNTRY")
    except ValueError:
        return {}
    return {int(code): iso3 for label, code in vd.codes.items() if (iso3 := country_name_to_iso3(str(label)))}


def labels_subset_for_country(
    ddi: Codebook,
    country_df: pd.DataFrame,
) -> dict[str, dict[int, str]]:
    """Keep labels only for values that appear in this country's data."""
    out: dict[str, dict[int, str]] = {}
    for col in country_df.columns:
        try:
            vd = ddi.get_variable_info(col)
        except ValueError:
            continue
        if not vd.codes:
            continue
        full = {int(v): str(k) for k, v in vd.codes.items()}  # The codebook maps label → code; we want code → label.
        present = set(country_df[col].dropna().astype(int).unique().tolist())
        if subset := {c: full[c] for c in present if c in full}:
            out[col] = subset
    return out


def find_extract_files(batch_dir: Path) -> tuple[Path, Path] | None:
    if (ddi_path := next(batch_dir.glob("*.xml"), None)) is None:
        return None
    ddi = readers.read_ipums_ddi(ddi_path)
    dat_path = batch_dir / ddi.file_description.filename
    # If the named data file is missing, use the first matching file.
    if not dat_path or (not dat_path.exists() and (dat_path := next(batch_dir.glob("*.dat*"), None)) is None):
        return None
    return ddi_path, dat_path


CHUNK_SIZE = 500_000


def process_batch(
    batch_dir: Path,
    extract_id: int | None,
    only_iso3: set[str] | None,
    samples: list[str],
    *,
    force: bool = False,
) -> list[dict[str, Any]]:
    # Reuse finished countries and avoid reading the batch when all are done.
    expected = batch_iso3_set(samples, only_iso3)
    done = set() if force else {iso3 for iso3 in expected if country_outputs_complete(iso3)}
    written: list[dict[str, Any]] = []
    for iso3 in sorted(done):
        n = _meta_n_persons(iso3)
        log(f"  reuse {iso3}: already prepared (n={n:,})")
        written.append({"iso3": iso3, "n_persons": n})
    if expected and done == expected:
        log(f"  all {len(expected)} countries already prepared; skipping stream")
        return written

    found = find_extract_files(batch_dir)
    if found is None:
        log(f"  [skip] {batch_dir.name}: no .xml/.dat in cache")
        return written
    ddi_path, dat_path = found
    ddi = readers.read_ipums_ddi(ddi_path)

    log("  building COUNTRY → ISO3 map from the codebook…")
    country_map = country_code_to_iso3_map(ddi)
    if not country_map:
        log(f"  ⚠ {batch_dir.name}: no COUNTRY codes found in the codebook")
        return written
    # Read only requested countries that still need output.
    keep_codes = {
        code for code, iso3 in country_map.items() if (only_iso3 is None or iso3 in only_iso3) and iso3 not in done
    }

    log(
        f"  streaming {dat_path.name} ({fmt_bytes(dat_path.stat().st_size)} compressed)"
        f" in chunks of {CHUNK_SIZE:,} rows…"
    )
    t0 = time.perf_counter()
    per_country: defaultdict[int, list[pd.DataFrame]] = defaultdict(list)
    read_rows = 0
    kept_rows = 0
    chunks = readers.read_microdata_chunked(ddi, dat_path, chunksize=CHUNK_SIZE)
    for i, chunk in enumerate(chunks, 1):
        n_in = len(chunk)
        read_rows += n_in
        chunk = apply_filters(chunk)
        chunk = chunk[chunk["COUNTRY"].astype(int).isin(keep_codes)]
        n_out = len(chunk)
        kept_rows += n_out
        log(
            f"    chunk {i:>3}: read {n_in:,} kept {n_out:,}"
            f" (cum read {read_rows:,}, kept {kept_rows:,},"
            f" {time.perf_counter() - t0:.1f}s)"
        )
        if n_out == 0:
            continue
        for code, sub in chunk.groupby("COUNTRY"):
            per_country[int(code)].append(sub)
    log(
        f"  streamed in {time.perf_counter() - t0:.1f}s:"
        f" {read_rows:,} rows read → {kept_rows:,} kept across {len(per_country)} countries"
    )

    sample_ids = list(ddi.samples_description or [])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    total = len(per_country)
    for i, (code, parts) in enumerate(sorted(per_country.items()), 1):
        iso3 = country_map[code]

        # Do not replace a country that another run finished.
        if not force and country_outputs_complete(iso3):
            log(f"    [{i}/{total}] {iso3}: already prepared, skipping")
            written.append({"iso3": iso3, "n_persons": _meta_n_persons(iso3)})
            continue

        sub = pd.concat(parts, ignore_index=True) if len(parts) > 1 else parts[0]
        parts.clear()

        log(f"    [{i}/{total}] {iso3}: writing n={len(sub):,} cols={len(sub.columns)}…")
        t1 = time.perf_counter()
        # Write the meta file last, so an interrupted country is never taken for a finished one.
        _atomic_write_parquet(sub, OUT_DIR / f"{iso3}.parquet")
        labels = labels_subset_for_country(ddi, sub)
        _atomic_write_text(
            OUT_DIR / f"{iso3}.labels.json",
            json.dumps(labels, indent=2, ensure_ascii=False),
        )
        meta = {
            "iso3": iso3,
            "ipums_extract_id": extract_id,
            "ipums_collection": "ipumsi",
            "ipums_samples": sample_ids,
            "ipums_country_code": code,
            "ipums_citation": ddi.ipums_citation,
            "n_persons": len(sub),
            "columns": list(sub.columns),
            "prepared_at": now_iso(),
        }
        _atomic_write_text(
            OUT_DIR / f"{iso3}.meta.json",
            json.dumps(meta, indent=2, ensure_ascii=False),
        )
        log(f"      done in {time.perf_counter() - t1:.1f}s")
        written.append({"iso3": iso3, "n_persons": len(sub)})

    return written


def main(
    only: Annotated[tuple[str, ...], tyro.conf.arg(help="Restrict output to these ISO3 codes.")] = (),
    only_batch: Annotated[
        str | None,
        tyro.conf.arg(help="Process only this batch id, e.g. batch-000."),
    ] = None,
    force: Annotated[
        bool,
        tyro.conf.arg(help="Re-prepare batches already marked prepared."),
    ] = False,
) -> None:
    only_iso3 = set(only) if only else None
    state = load_state(STATE_PATH)

    summary: list[dict[str, Any]] = []
    for entry in state.get("batches", []):
        if only_batch and entry["batch_id"] != only_batch:
            continue
        if entry["status"] != "downloaded":
            log(f"[{entry['batch_id']}] status={entry['status']}, skipping")
            continue
        # Only full runs mark the whole batch as prepared.
        if entry.get("prepared_at") and only_iso3 is None and not force:
            log(f"[{entry['batch_id']}] already prepared at {entry['prepared_at']}, skipping (--force to redo)")
            continue
        batch_dir = CACHE_ROOT / entry["batch_id"]
        log(f"[{entry['batch_id']}] extract {entry['extract_id']}")
        written = process_batch(batch_dir, entry.get("extract_id"), only_iso3, entry.get("samples", []), force=force)
        summary.extend(written)
        if only_iso3 is None:
            entry["prepared_at"] = now_iso()
            entry["prepared_iso3"] = sorted({w["iso3"] for w in written})
            save_state(STATE_PATH, state)

    log(f"\nprepared {len(summary)} per-country outputs in {OUT_DIR}")


def cli() -> None:
    tyro.cli(main, description=__doc__, config=(tyro.conf.FlagCreatePairsOff,))


if __name__ == "__main__":
    cli()
