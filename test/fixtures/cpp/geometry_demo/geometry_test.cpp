// geometry_demo/geometry_test.cpp — gtest discovery: TEST(Suite, Name)
// macros parse as function definitions named TEST whose params carry
// the identity.
#include "geometry.h"

#include <cstdio>

TEST(GeometrySuite, AreaOfUnitCircle) {
  Circle c(1.0);
  double a = c.area();
  double total = area_sum(&c, 1);
  printf("%f %f\n", a, total);
}
