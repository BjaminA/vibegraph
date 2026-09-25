// geometry_demo/main.cpp — the cli entry. Shaped to pin: cross-file
// linking through the header convention (area_sum → geometry.cpp),
// overload honesty (scale → unresolved), template dispatch (clamp2<T>
// → dynamic), local-receiver honesty (c.area() → dynamic), and the
// effect vocabulary (fopen→fs, printf→log, system→subprocess).
#include "geometry.h"

#include <cstdio>
#include <cstdlib>

template <typename T>
T clamp2(T v, T lo, T hi) {
  if (v < lo) {
    return lo;
  }
  if (v > hi) {
    return hi;
  }
  return v;
}

static void report(double value) {
  printf("value=%f\n", value);
}

// Measure one circle, scale and clamp the total, write the report.
int main(int argc, char** argv) {
  Circle c(2.0);
  double a = c.area();
  double total = area_sum(&c, 1);
  double s = scale(total);
  double t = clamp2<double>(s, 0.0, 100.0);
  auto* f = fopen("report.txt", "w");
  if (f != nullptr) {
    fprintf(f, "%f\n", t);
  }
  report(t);
  system("date");
  return 0;
}
