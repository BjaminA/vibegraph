// geometry_demo — M-LANG5a fixture header. Declarations live here;
// definitions in the companion geometry.cpp (the link convention the
// v1 linker follows). `scale` is deliberately OVERLOADED — the
// honesty showcase: the linker must refuse to pick.
#pragma once

class Circle {
 public:
  explicit Circle(double r);
  double area() const;

 private:
  double r_;
};

double area_sum(const Circle* shapes, int count);
double scale(double v);
double scale(double v, double factor);
