"""Build one website model per country from prepared IPUMS data."""

import contextlib
import json
import sys
from pathlib import Path
from typing import Annotated, Any

import numpy as np
import pandas as pd
import pycountry
import tyro

from lib_ipums import POPULATION, now_iso

ROOT = Path(__file__).resolve().parent.parent
PER_COUNTRY = ROOT / "cache" / "per_country"
OUT_DIR = ROOT.parent / "website" / "src" / "data" / "country_models"
GEO1_LABELS_PATH = ROOT / "resources" / "geolev1_labels.json"

SCHEMA_VERSION = "1.1"
INDEX_SCHEMA_VERSION = "1.0"

# Load readable region names from the IPUMS location PDF.
GEO1_LABELS: dict[str, str] = json.loads(GEO1_LABELS_PATH.read_text()) if GEO1_LABELS_PATH.exists() else {}

# Names shown to users for each IPUMS field.
VAR_LABEL: dict[str, str] = {
    "GEOLEV2": "Home location",
    "GEOLEV1": "Home location",
    "AGE": "Age",
    "SEX": "Sex",
    "MARST": "Marital status",
    "RELIGION": "Religion",
    "RACE": "Race",
    "EDATTAIN": "Education",
    "EMPSTAT": "Employment",
    "URBAN": "Urban/rural",
    "CHBORN": "Children born",
}

# Do not treat helper columns as answers.
DROP_COLS = {"COUNTRY", "YEAR", "SAMPLE", "SERIAL", "PERNUM", "PERWT", "HHWT", "RESIDENT", "HHTYPE"}


def choose_feature_columns(df: pd.DataFrame) -> list[str]:
    """Choose useful answer columns while keeping their original order."""
    cols = [c for c in df.columns if c not in DROP_COLS and not c.endswith("D")]
    # Keep the broader region because its codes have readable names.
    if "GEOLEV1" in cols and "GEOLEV2" in cols:
        cols.remove("GEOLEV2")
    return [c for c in cols if df[c].nunique(dropna=True) >= 2]


def remap_to_contiguous(col: pd.Series) -> tuple[np.ndarray, list[int]]:
    """Renumber the values 1, 2, 3… and return the original codes in that same order."""
    uniq = sorted(col.dropna().astype(int).unique().tolist())
    lut = {v: i + 1 for i, v in enumerate(uniq)}
    return col.astype(int).map(lut).to_numpy(dtype=np.int64), uniq


def extract_sigma_and_probs(G: Any, n_cols: int) -> tuple[np.ndarray, list[np.ndarray]]:
    """Read the correlation matrix and the answer frequencies out of the fitted Julia model."""
    from juliacall import Main as jl

    sigma = np.array(jl.getproperty(G, jl.Symbol("Σ")))
    marginals_jl = jl.getproperty(G, jl.Symbol("marginals"))
    probs = [np.array(jl.getproperty(marginals_jl[i], jl.Symbol("p"))) for i in range(n_cols)]
    return sigma, probs


def build_uniq_vals(
    col: str,
    sorted_codes: list[int],
    labels: dict[str, dict[str, str]],
) -> list[Any]:
    """Return the values shown to users for a column."""
    if col == "AGE":
        return sorted_codes
    if col == "GEOLEV1":
        # Use "Unknown" when the PDF has no region name.
        return [GEO1_LABELS.get(str(c), "Unknown") for c in sorted_codes]
    code_to_label = labels.get(col, {})
    return [code_to_label.get(str(c), c) for c in sorted_codes]


def country_name(iso3: str) -> str:
    country = pycountry.countries.get(alpha_3=iso3)
    if country is None:
        return iso3
    return str(getattr(country, "common_name", None) or country.name)


def fit_one(iso3: str) -> dict[str, Any] | None:
    parquet = PER_COUNTRY / f"{iso3}.parquet"
    labels_path = PER_COUNTRY / f"{iso3}.labels.json"
    meta_path = PER_COUNTRY / f"{iso3}.meta.json"
    if not all(p.exists() for p in (parquet, labels_path, meta_path)):
        print(f"  [skip] {iso3}: missing cache files")
        return None

    df = pd.read_parquet(parquet)
    labels = json.loads(labels_path.read_text())
    meta = json.loads(meta_path.read_text())

    feature_cols = choose_feature_columns(df)
    if len(feature_cols) < 2:
        print(f"  [skip] {iso3}: only {len(feature_cols)} usable columns")
        return None

    n_rows = len(df)
    data = np.empty((n_rows, len(feature_cols)), dtype=np.int64)
    sorted_codes_per_col: list[list[int]] = []
    for j, col in enumerate(feature_cols):
        remapped, sorted_codes = remap_to_contiguous(df[col])
        data[:, j] = remapped
        sorted_codes_per_col.append(sorted_codes)

    print(f"  fitting a Gaussian copula on {n_rows} rows × {len(feature_cols)} columns…")
    import correctmatch

    G = correctmatch.fit_model(data, exact_marginal=True)

    sigma, probs_per_col = extract_sigma_and_probs(G, len(feature_cols))
    assert sigma.shape == (len(feature_cols), len(feature_cols))

    # Build the answer choices and frequencies shown on the site.
    marginals_out: dict[str, dict[str, Any]] = {}
    avail_var: list[str] = []
    for j, col in enumerate(feature_cols):
        label = VAR_LABEL.get(col, col)
        if label in marginals_out:
            print(f"  ⚠ duplicate label {label!r} for {col!r}; skipping")
            continue
        uniq_vals = build_uniq_vals(col, sorted_codes_per_col[j], labels)
        p = probs_per_col[j]
        if len(p) != len(uniq_vals):
            print(f"  ⚠ {iso3}/{col}: |p|={len(p)} vs |uniqVals|={len(uniq_vals)}")
            return None
        marginals_out[label] = {
            "probs": [float(x) for x in p.tolist()],
            "uniqVals": uniq_vals,
        }
        avail_var.append(label)

    if (pop_num := POPULATION.get(iso3)) is None:
        print(f"  ⚠ {iso3}: no population in lib_ipums.POPULATION; pop_num=null")

    meta_iso3 = meta.get("iso3", iso3)

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "iso3": meta_iso3,
        "name": country_name(meta_iso3),
        "source": {
            "ipums_collection": meta.get("ipums_collection", "ipumsi"),
            "ipums_extract_id": meta.get("ipums_extract_id"),
            "ipums_samples": meta.get("ipums_samples") or [],
            "ipums_country_code": meta.get("ipums_country_code"),
            "ipums_citation": meta.get("ipums_citation"),
            "n_persons": int(meta.get("n_persons", n_rows)),
        },
        "avail_var": avail_var,
        "marginals": marginals_out,
        "pop_num": pop_num,
        "corr": sigma.tolist(),
    }


def write_manifest(entries: list[dict[str, Any]]) -> None:
    """Add new countries without removing entries from earlier runs."""
    manifest_path = OUT_DIR / "manifest.json"
    existing: dict[str, Any] = {}
    if manifest_path.exists():
        with contextlib.suppress(json.JSONDecodeError):
            existing = json.loads(manifest_path.read_text())
    by_iso = {e["iso3"]: e for e in existing.get("countries", [])}
    by_iso.update({e["iso3"]: e for e in entries})
    countries = sorted(by_iso.values(), key=lambda x: x["iso3"])
    merged = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "countries": countries,
    }
    manifest_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n")
    print(
        f"\nmanifest: {len(countries)} countries → {manifest_path.relative_to(ROOT.parent)}",
    )
    write_country_index(countries)


def write_country_index(countries: list[dict[str, Any]]) -> None:
    """Write the short country list that the browser loads before any single model."""
    index_path = OUT_DIR / "countries.json"
    index = {
        "schema_version": INDEX_SCHEMA_VERSION,
        "countries": [{"iso3": c["iso3"], "name": c["name"]} for c in countries],
    }
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    print(f"index: {len(countries)} countries → {index_path.relative_to(ROOT.parent)}")


def main(
    only: Annotated[tuple[str, ...], tyro.conf.arg(help="Restrict to these ISO3 codes.")] = (),
) -> None:
    if not PER_COUNTRY.exists():
        print(f"ERROR: {PER_COUNTRY} not found; run ipums-prepare first", file=sys.stderr)
        raise SystemExit(2)

    iso_list = sorted({p.stem for p in PER_COUNTRY.glob("*.parquet")})
    if only:
        wanted = set(only)
        for missing in sorted(wanted - set(iso_list)):
            print(f"  ⚠ {missing}: no parquet in {PER_COUNTRY}")
        iso_list = [i for i in iso_list if i in wanted]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_entries: list[dict[str, Any]] = []

    for iso3 in iso_list:
        print(f"[{iso3}]")
        out = fit_one(iso3)
        if out is None:
            continue
        out_path = OUT_DIR / f"{iso3}.json"
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
        manifest_entries.append(
            {
                "iso3": iso3,
                "name": country_name(iso3),
                "file": f"{iso3}.json",
                "n_persons": out["source"]["n_persons"],
                "pop_num": out["pop_num"],
                "n_attrs": len(out["avail_var"]),
                "avail_var": out["avail_var"],
                "ipums_samples": out["source"]["ipums_samples"],
            },
        )
        print(f"  wrote {out_path.relative_to(ROOT.parent)}")

    write_manifest(manifest_entries)


def cli() -> None:
    tyro.cli(main, description=__doc__, config=(tyro.conf.FlagCreatePairsOff,))


if __name__ == "__main__":
    cli()
