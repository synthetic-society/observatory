/*
 * Small C entry point for the f2c translation of Genz's MVNDST.
 */

#include <math.h>

#include "f2c.h"

/* Subroutine */ extern int mvndst_(integer *n, doublereal *lower, doublereal *upper,
                                    integer *infin, doublereal *correl, integer *maxpts,
                                    doublereal *abseps, doublereal *releps, doublereal *error,
                                    doublereal *value, integer *inform);

/*
 * Defining these two helpers here avoids cross-compiling the whole library.
 */
doublereal d_mod(doublereal *x, doublereal *y) { return fmod(*x, *y); }
doublereal pow_dd(doublereal *x, doublereal *y) { return pow(*x, *y); }

/* MVNDST handles at most 100 dimensions. */
#define MVNDST_MAX_DIM 100

/*
 * Integrates the multivariate normal density over the box [lower, upper].
 *
 * `correl` holds the strict lower triangle of the correlation matrix in row
 * order. Returns 0 when the dimension is out of range or MVNDST reports a failure.
 */
double mvndst_cdf(int n, const double *lower, const double *upper, const double *correl,
                  int maxpts, double abseps, double releps) {
  integer infin[MVNDST_MAX_DIM];
  integer dim = n, pts = maxpts, inform = 0;
  doublereal eps_abs = abseps, eps_rel = releps, error = 0, value = 0;

  if (n < 1 || n > MVNDST_MAX_DIM) return 0;
  for (int i = 0; i < n; i++) {
    int unbounded_below = isinf(lower[i]) && lower[i] < 0;
    int unbounded_above = isinf(upper[i]) && upper[i] > 0;
    infin[i] = unbounded_below ? (unbounded_above ? -1 : 0) : (unbounded_above ? 1 : 2);
  }

  mvndst_(&dim, (doublereal *)lower, (doublereal *)upper, infin, (doublereal *)correl, &pts,
          &eps_abs, &eps_rel, &error, &value, &inform);
  return inform == 0 || inform == 1 ? value : 0;
}
