"""Download each country's newest IPUMS data and save progress."""

import os
import sys
import time
from itertools import batched
from pathlib import Path
from typing import Annotated, Any

import tyro
from dotenv import load_dotenv
from ipumspy import IpumsApiClient, MicrodataExtract
from ipumspy.api.exceptions import (
    IpumsApiRateLimitException,
    IpumsExtractFailure,
    IpumsTimeoutException,
)

from lib_ipums import (
    SampleKey,
    latest_sample_per_country,
    load_state,
    now_iso,
    save_state,
    token_to_iso3,
)

VARIABLES = [
    "COUNTRY",
    "AGE",
    "SEX",
    "MARST",
    "RELIGION",
    "RACE",
    "EDATTAIN",
    "EMPSTAT",
    "GEOLEV1",
    "GEOLEV2",
    "URBAN",
    "CHBORN",
    "PERWT",
    "SERIAL",
    "PERNUM",
]

ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT / "state" / "extracts.json"
CACHE_ROOT = ROOT / "cache"


def select_samples(client: IpumsApiClient, restrict: set[str] | None) -> list[SampleKey]:
    raw = client.get_all_sample_info("ipumsi")
    sample_ids = raw.keys() & restrict if restrict else raw
    return sorted(latest_sample_per_country(sample_ids).values(), key=lambda sample: sample.sample_id)


def print_selection(selection: list[SampleKey]) -> None:
    rows = [(token_to_iso3(sk.country_token) or "???", sk.country_token, sk.sample_id, sk.year) for sk in selection]
    unmapped = [r for r in rows if r[0] == "???"]
    print(f"selected {len(rows)} samples ({len(unmapped)} with no ISO3 mapping)")
    print(f"{'ISO3':<5} {'token':<6} {'sample':<12} {'year':<5}")
    for r in rows:
        print(f"{r[0]:<5} {r[1]:<6} {r[2]:<12} {r[3]:<5}")
    if unmapped:
        print("\n⚠ unmapped tokens — add to lib_ipums.IPUMS_TOKEN_TO_ISO3:")
        for r in unmapped:
            print(f"   {r[1]!r}")


# -- Download batches ------------------------------------------------------


def reconcile_batch(state: dict[str, Any], batch_id: str, batch: list[SampleKey]) -> dict[str, Any]:
    for entry in state["batches"]:
        if entry["batch_id"] == batch_id:
            return entry
    entry = {
        "batch_id": batch_id,
        "samples": [sk.sample_id for sk in batch],
        "extract_id": None,
        "status": "pending",
        "submitted_at": None,
        "downloaded_at": None,
    }
    state["batches"].append(entry)
    save_state(STATE_PATH, state)
    return entry


def process_batch(
    client: IpumsApiClient,
    state: dict[str, Any],
    entry: dict[str, Any],
    batch: list[SampleKey],
) -> None:
    batch_dir = CACHE_ROOT / entry["batch_id"]
    batch_dir.mkdir(parents=True, exist_ok=True)

    extract = None
    if entry["extract_id"] is not None:
        existing = client.get_extract_by_id(entry["extract_id"], "ipumsi")
        # Restore the ID needed by later requests.
        existing._id = entry["extract_id"]
        if client.extract_is_expired(existing, "ipumsi"):
            print(f"[{entry['batch_id']}] extract {entry['extract_id']} expired, resubmitting")
            entry["extract_id"] = None
        else:
            extract = existing

    if extract is None:
        extract = MicrodataExtract(
            collection="ipumsi",
            samples=[sk.sample_id for sk in batch],
            variables=VARIABLES,
            description=f"observatory-v2 {entry['batch_id']} {now_iso()[:10]}",
            data_format="fixed_width",
        )
        client.submit_extract(extract)
        entry["extract_id"] = extract.extract_id
        entry["submitted_at"] = now_iso()
        entry["status"] = "submitted"
        save_state(STATE_PATH, state)
        print(f"[{entry['batch_id']}] submitted extract {extract.extract_id}")

    status = client.extract_status(extract, "ipumsi")
    print(f"[{entry['batch_id']}] extract {entry['extract_id']} status={status}")
    entry["status"] = status
    save_state(STATE_PATH, state)

    if status not in ("completed", "downloaded"):
        try:
            client.wait_for_extract(
                extract,
                collection="ipumsi",
                inital_wait_time=5,  # The library spells this option this way.
                max_wait_time=300,
                timeout=3 * 60 * 60,
            )
        except (IpumsExtractFailure, IpumsTimeoutException) as e:
            entry["status"] = "failed" if isinstance(e, IpumsExtractFailure) else "timeout"
            entry["error"] = str(e)
            save_state(STATE_PATH, state)
            raise
        entry["status"] = "completed"
        save_state(STATE_PATH, state)

    if entry["status"] != "downloaded":
        client.download_extract(extract, collection="ipumsi", download_dir=batch_dir)
        entry["status"] = "downloaded"
        entry["downloaded_at"] = now_iso()
        save_state(STATE_PATH, state)
        print(f"[{entry['batch_id']}] downloaded to {batch_dir}")


def main(
    dry_run: Annotated[bool, tyro.conf.arg(help="Print sample selection and exit.")] = False,
    batch_size: Annotated[int, tyro.conf.arg(help="Samples per IPUMS extract.")] = 10,
    only_samples: Annotated[tuple[str, ...], tyro.conf.arg(help="Restrict to these sample IDs.")] = (),
    only_batch: Annotated[
        int | None,
        tyro.conf.arg(help="Process only batch index N."),
    ] = None,
    max_batches: Annotated[int | None, tyro.conf.arg(help="Stop after N batches.")] = None,
) -> None:
    load_dotenv(ROOT / ".env")
    if not (api_key := os.environ.get("IPUMS_API_KEY")):
        print(
            "ERROR: set IPUMS_API_KEY in env or .env (https://account.ipums.org/api_keys)",
            file=sys.stderr,
        )
        raise SystemExit(2)

    client = IpumsApiClient(api_key)
    print("fetching IPUMS-International sample catalog…")
    selection = select_samples(client, set(only_samples) or None)
    print_selection(selection)
    if dry_run:
        return

    batches = [list(b) for b in batched(selection, batch_size)]
    print(f"\n→ {len(batches)} batches of ≤{batch_size} samples\n")

    state = load_state(STATE_PATH)
    state.setdefault("variables", VARIABLES)
    state.setdefault("created_at", now_iso())

    processed = 0
    for i, batch in enumerate(batches):
        if only_batch is not None and i != only_batch:
            continue
        if max_batches is not None and processed >= max_batches:
            break
        batch_id = f"batch-{i:03d}"
        entry = reconcile_batch(state, batch_id, batch)
        if entry["status"] == "downloaded":
            print(f"[{batch_id}] already downloaded, skipping")
            continue
        try:
            process_batch(client, state, entry, batch)
        except IpumsApiRateLimitException:
            print(f"[{batch_id}] rate-limited, sleeping 60s")
            time.sleep(60)
            process_batch(client, state, entry, batch)
        processed += 1

    print(f"\ndone. {processed} batches processed; state in {STATE_PATH}")


def cli() -> None:
    tyro.cli(main, description=__doc__, config=(tyro.conf.FlagCreatePairsOff,))


if __name__ == "__main__":
    cli()
