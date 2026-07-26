# Pre-training for the Observatory of Anonymity

Builds one statistical model per country for the Observatory quiz, fitted to census microdata from
IPUMS-International. It uses `correctmatch`, a Python wrapper built with `juliacall` to use the
Julia package `CorrectMatch.jl` (Rocher, Hendrickx, de Montjoye, 2019).

```
uv run ipums-fetch    # fetch and download extracts from IPUMS
uv run ipums-prepare  # Clean downloaded extracts and save `cache/per_country/{ISO3}.parquet` for each country
uv run train-model    # fit one model per country into `../website/src/data/country_models/{ISO3}.json`
```

`train-model` outputs three kinds of file into `../website/src/data/country_models/`:

| File             | Contents                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| `{ISO3}.json`    | One fitted model with empirical marginals, correlation matrix, population, and source. |
| `manifest.json`  | IPUMS and model metadata for every country.                                            |
| `countries.json` | Short `{iso3, name}` list (`schema_version` 1.0) used by the country picker.           |

## Initial setup

1. Get an IPUMS-International account: <https://international.ipums.org/international-action/menu>.
2. Generate an API key: <https://account.ipums.org/api_keys>.
3. Put it in `.env`: `IPUMS_API_KEY=xxxx` or export it in the shell.
4. `uv sync` to create the virtual environment from `pyproject.toml` (Python ≥3.13).

## Run order

```fish
cd pre-training

uv run ipums-fetch --dry-run        # see which samples would be used
uv run ipums-fetch                  # submit and download (hours)
uv run ipums-prepare                # split by country (minutes)
uv run train-model                  # fit the models (first run installs Julia)
```

You can try one small country, say CRI, before running all of them:

```fish
uv run ipums-fetch --only-samples cr2011a
uv run ipums-prepare --only CRI
uv run train-model --only CRI
```

## Layout

```
pre-training/
├── README.md               # this file
├── pyproject.toml          # dependencies and commands
├── src/
│   ├── lib_ipums.py        # helpers shared by the commands
│   ├── ipums_fetch.py      # step 1: download from IPUMS
│   ├── ipums_prepare.py    # step 2: cleaning and splitting
│   ├── train_model.py      # step 3: model fitting
│   ├── build_geo_labels.py # region names for GEOLEV1 codes
│   └── gen_reference.py    # test data for the website's model code
├── state/                  # committed: extract IDs so a run can resume (JSON only)
│   └── extracts.json
└── cache/                  # gitignored: IPUMS-licensed microdata
    ├── batch-000/          # raw .dat.gz + .xml from IPUMS
    ├── batch-001/
    └── per_country/        # one parquet, labels file, and metadata file per country
        ├── ARG.parquet
        ├── ARG.labels.json
        └── ARG.meta.json
```

## IPUMS data

We use data from the Integrated Public Use Microdata Series, International (IPUMS-International),
which is a project of the Minnesota Population Center:

> Minnesota Population Center. Integrated Public Use Microdata Series, International:
> Version 7.x [dataset]. Minneapolis, MN: IPUMS, 2024. <https://doi.org/10.18128/D020.V7.x>

IPUMS-International data is licensed for research use and **cannot be redistributed**. Only the
fitted per-country JSON models in `../website/src/data/country_models/` are distributed here.
These files contain summary statistics and not individual records.

We use the following variables from IPUMS-International:

| IPUMS             | v2 label       | Notes                                                               |
| ----------------- | -------------- | ------------------------------------------------------------------- |
| GEOLEV1 / GEOLEV2 | Home location  | GEOLEV1 preferred where available                                   |
| AGE               | Age            | 0–100 integer; drop AGE=999                                         |
| SEX               | Sex            | drop SEX=9                                                          |
| MARST             | Marital status | drop MARST in {0, 9}                                                |
| RELIGION          | Religion       | drop in {0, 9}                                                      |
| RACE              | Race           | drop RACE=99                                                        |
| EDATTAIN          | Education      | drop in {0, 9}                                                      |
| EMPSTAT           | Employment     | drop in {0, 3, 9}                                                   |
| URBAN             | Urban/rural    | drop in {0, 9} (question not asked, or unknown. Check each country) |
| CHBORN            | Children born  | drop CHBORN in {98, 99}                                             |
