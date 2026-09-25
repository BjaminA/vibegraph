#include "pricing.h"

double line_total(const Item& item) {
  return item.qty * item.unit_price;
}

// Sum every line, then apply the default discount.
double price_total(const Item* items, int count) {
  double total = 0.0;
  for (int i = 0; i < count; ++i) {
    total += line_total(items[i]);
  }
  return discount(total);
}

double discount(double total) {
  return total * 0.95;
}

double discount(double total, double rate) {
  return total * (1.0 - rate);
}
