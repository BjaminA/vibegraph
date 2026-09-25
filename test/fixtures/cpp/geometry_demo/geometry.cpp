#include "geometry.h"

#include <cstdio>

static const double PI = 3.14159265358979;

Circle::Circle(double r) : r_(r) {}

double Circle::area() const {
  return PI * r_ * r_;
}

// Sum the areas of `count` circles, logging how many were folded in.
double area_sum(const Circle* shapes, int count) {
  double total = 0.0;
  for (int i = 0; i < count; i++) {
    total += shapes[i].area();
  }
  printf("summed %d shapes\n", count);
  return total;
}

double scale(double v) {
  return v * 2.0;
}

double scale(double v, double factor) {
  return v * factor;
}
