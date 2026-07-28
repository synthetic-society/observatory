# The Observatory of Anonymity

Source code for the Observatory of anonymity, available online at [https://ooa.world/](https://ooa.world/).
The Observatory of Anonymity allows users to test their degree of anonymity in 89 different countries.

This is a client-side only application developed in TypeScript. All the computation to run the models are done directly in the browser.
The Observatory uses a statistical model developed in our original article [‘Estimating the success of re-identifications in incomplete datasets using generative models’](https://www.nature.com/articles/s41467-019-10933-3), published in Nature Communications.

An earlier version of the Observatory is available in the [version-1](https://github.com/synthetic-society/observatory/tree/version-1) branch. The current version is a complete rewrite of the original codebase, with more data, faster maths, and a more user-friendly interface.

# Overview of the codebase

This repository follows a small monorepo structure, with three parts

```text
.
├── mvndst/        # Fortran to WebAssembly build of the statistical routine
├── pre-training/  # Python pipeline that builds the country models
└── website/       # Astro website that uses the generated models
```

The website uses a WebAssembly version of Alan Genz's MVNDST statistical code.
You should rebuild it only when the source or toolchain changes see
[`mvndst/README.md`](mvndst/README.md).

The pre-training pipeline is a separate `uv` project; see
[`pre-training/README.md`](pre-training/README.md) for further details. You should run it only to add new countries or when the IPUMS data changes.

# Quick start


The website is a small [Astro](https://astro.build/) project, with [Bun](https://bun.sh/) as package manager:
```sh
cd website
bun install    # Installs dependencies
bun run dev    # Starts the development server
bun run build  # Builds the website for production
bun run test   # Runs unit tests
bun run check  # Runs type checks and diagnostics
```

# License

GNU General Public License v3.0

See LICENSE to see the full text.

# To cite

```
@inproceedings{10.1145/3442442.3458606,
author = {Rocher, Luc and Muthu, Meenatchi Sundaram and de Montjoye, Yves-Alexandre},
title = {The Observatory of Anonymity: An Interactive Tool to Understand Re-Identification Risks in 89 Countries},
year = {2021},
isbn = {9781450383134},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
url = {https://doi.org/10.1145/3442442.3458606},
doi = {10.1145/3442442.3458606},
booktitle = {Companion Proceedings of the Web Conference 2021},
pages = {687–689},
numpages = {3},
location = {Ljubljana, Slovenia},
series = {WWW '21}
}
```