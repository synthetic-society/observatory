"""Shared tools for downloading and preparing IPUMS data."""

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pycountry

# Map unusual IPUMS country abbreviations to standard three-letter codes.
IPUMS_TOKEN_TO_ISO3: dict[str, str] = {
    "uk": "GBR",
    "ps": "PSE",
    "ws": "WSM",
}

# Handle country names that the standard country-name library does not recognize.
COUNTRY_NAME_TO_ISO3: dict[str, str] = {
    "Bolivia": "BOL",
    "Bolivia, Plurinational State of": "BOL",
    "Côte d'Ivoire": "CIV",
    "Cote d'Ivoire": "CIV",
    "Czechoslovakia": "CZE",
    "Iran": "IRN",
    "Kyrgyz Republic": "KGZ",
    "Laos": "LAO",
    "Moldova": "MDA",
    "Palestine": "PSE",
    "Russia": "RUS",
    "South Korea": "KOR",
    "Korea, Republic of": "KOR",
    "Tanzania": "TZA",
    "United Kingdom": "GBR",
    "United States": "USA",
    "Venezuela": "VEN",
    "Vietnam": "VNM",
}

# Country populations, 2023 estimates. Update these from time to time.
# fmt: off
POPULATION: dict[str, int] = {
    "ARG": 46654000, "ARM": 2778000, "AUT": 9133000, "BEL": 11686000, "BEN": 13712000, "BFA": 23251000,
    "BGD": 172954000, "BLR": 9498000, "BOL": 12388000, "BRA": 216422000, "BWA": 2675000, "CAN": 40098000,
    "CHE": 8849000, "CHL": 19629000, "CHN": 1410710000, "CIV": 28873000, "CMR": 28647000, "COL": 52085000,
    "CRI": 5212000, "CUB": 11194000, "DOM": 11332000, "ECU": 17765000, "EGY": 112717000, "ESP": 48374000,
    "ETH": 126527000, "FJI": 924000, "FRA": 68170000, "GHA": 33788000, "GIN": 14191000, "GMB": 2773000,
    "GRC": 10394000, "GTM": 17602000, "HND": 10593000, "HTI": 11724000, "HUN": 9590000, "IDN": 277534000,
    "IND": 1438070000, "IRL": 5271000, "IRN": 89173000, "IRQ": 45504000, "ISR": 9756000, "ITA": 58997000,
    "JAM": 2826000, "JOR": 11337000, "KEN": 55101000, "KGZ": 6970000, "KHM": 16944000, "LBR": 5418000,
    "LCA": 180000, "LSO": 2311000, "MAR": 37840000, "MDA": 2486000, "MEX": 128450000, "MLI": 23293000,
    "MMR": 54578000, "MNG": 3447000, "MOZ": 33897000, "MUS": 1262000, "MWI": 20932000, "MYS": 34308000,
    "NGA": 223804000, "NIC": 6850000, "NLD": 17880000, "NPL": 30897000, "PAK": 240486000, "PAN": 4468000,
    "PER": 34352000, "PHL": 117337000, "PRI": 3221000, "PRT": 10412000, "PRY": 6862000, "PSE": 5371000,
    "ROU": 19051000, "RUS": 143826000, "RWA": 13954000, "SDN": 48109000, "SEN": 17763000, "SLE": 8606000,
    "SLV": 6364000, "SOM": 18143000, "SUR": 624000, "SWE": 10551000, "TGO": 9054000, "THA": 71801000, "TON": 105000,
    "TTO": 1535000, "TUR": 85816000, "TZA": 67438000, "UGA": 48582000, "UKR": 36744000, "URY": 3423000,
    "USA": 334915000, "VEN": 28838000, "VNM": 100352000, "WSM": 226000, "YEM": 34450000, "ZAF": 60414000,
    "ZMB": 20570000, "ZWE": 16665000, "DEU": 84482000, "DNK": 5933000, "FIN": 5564000, "GBR": 67330000, "ISL": 388000,
    "LAO": 7634000, "NOR": 5520000, "PNG": 10329000, "POL": 36821000, "SSD": 11089000, "SVK": 5426000, "SVN": 2118000,
}
# fmt: on


# -- Sample names -----------------------------------------------------------

_SAMPLE_RE = re.compile(r"^([a-z]{2,3})(\d{4})([a-z]?)$")


@dataclass(frozen=True, slots=True)
class SampleKey:
    sample_id: str
    country_token: str
    year: int
    suffix: str

    @property
    def sort_key(self) -> tuple[int, str]:
        return self.year, self.suffix


def parse_sample_id(sample_id: str) -> SampleKey | None:
    """Split an IPUMS sample name like 'br1960a' into its parts."""
    if (m := _SAMPLE_RE.match(sample_id)) is None:
        return None
    return SampleKey(sample_id, m.group(1), int(m.group(2)), m.group(3))


def latest_sample_per_country(sample_ids: Iterable[str]) -> dict[str, SampleKey]:
    """Keep only the newest sample for each country."""
    latest: dict[str, SampleKey] = {}
    for sid in sample_ids:
        if (k := parse_sample_id(sid)) is None:
            continue
        cur = latest.get(k.country_token)
        if cur is None or k.sort_key > cur.sort_key:
            latest[k.country_token] = k
    return latest


# -- Country codes ----------------------------------------------------------


def token_to_iso3(token: str) -> str | None:
    """Convert an IPUMS country abbreviation to a three-letter code."""
    token = token.lower()
    if iso3 := IPUMS_TOKEN_TO_ISO3.get(token):
        return iso3
    match len(token):
        case 2 if c := pycountry.countries.get(alpha_2=token.upper()):
            return c.alpha_3
        case 3 if c := pycountry.countries.get(alpha_3=token.upper()):
            return c.alpha_3
    return None


def country_name_to_iso3(name: str) -> str | None:
    """Convert a country name to its three-letter code."""
    if iso3 := COUNTRY_NAME_TO_ISO3.get(name):
        return iso3
    if c := pycountry.countries.get(name=name) or pycountry.countries.get(common_name=name):
        return c.alpha_3
    try:
        if hits := pycountry.countries.search_fuzzy(name):
            return hits[0].alpha_3
    except LookupError:
        pass
    return None


# -- Saved progress ---------------------------------------------------------


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def load_state(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text()) if path.exists() else {"batches": []}


def save_state(path: Path, state: dict[str, Any]) -> None:
    """Save progress, writing to a temporary file first so a crash cannot truncate it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(path)
