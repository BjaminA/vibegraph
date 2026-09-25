// shop_demo pricing worker — declarations. `discount` is OVERLOADED on
// purpose: the honest resolution gap the C++ linker must refuse to guess.
#pragma once

struct Item {
  const char* sku;
  int qty;
  double unit_price;
};

double line_total(const Item& item);
double price_total(const Item* items, int count);
double discount(double total);
double discount(double total, double rate);
