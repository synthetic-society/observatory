# Observatory of Anonymity

This repository contains the three parts of the Observatory:

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
[`pre-training/README.md`](pre-training/README.md) for its workflow.

Finally, the website is an independent Bun project:
```sh
cd website
bun install
bun run dev
bun run build
bun test
bun run check
```
