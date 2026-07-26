# mvndst

Builds a WebAssembly runtime to integrate the multivariate normal distribution, used in the
re-identification model of `website/src/model/copula.ts`.

We use the MVNDST Fortran routine original designed by Alan Genz at Washington State University,
from `scipy/stats/mvndst.f` in [scipy/scipy](https://github.com/scipy/scipy).

MVNDST and its helper routines are © 2000 Alan Genz, offered to SciPy under SciPy's BSD 3-Clause
licence (see `vendor/LICENSE-scipy.txt`)

## Building

```sh
sudo apt-get install f2c libf2c2-dev emscripten
mvndst/build.sh
```

We tested the build with Emscripten 3.1.69+dfsg-3 and f2c 20240504-1+b2 in Debian trixie. The
script `mvndst/build.sh` builds the Fortran with f2c, then compiles the C to WebAssembly with
Emscripten. It outputs three files:

- `mvndst.mjs`: Emscripten ES module, default export `createMvndst()`.
- `mvndst.wasm`: the compiled routine.
- `mvndst.d.mts`: TypeScript types for `website/src/model/mvndst.ts`.

## Interface

```c
double mvndst_cdf(int n, const double *lower, const double *upper,
                  const double *correl, int maxpts, double abseps, double releps);
```

All floating point is IEEE-754 double; `n` and `maxpts` are 32-bit. `correl` is the strict lower
triangle of the correlation matrix in row order (`n * (n - 1) / 2` values. . `mvndst_cdf` returns
the integral over the box, or `0` if `n` is outside 1..100.
