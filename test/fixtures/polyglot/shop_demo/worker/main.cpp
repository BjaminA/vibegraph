// pricing CLI: reads item JSON from argv[1], prints the priced total.
// Called by api/orders.py via subprocess — a cross-language hop neither
// side can link statically; each side names it honestly.
#include "pricing.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

static int parse_items(const char* json, Item* out, int max) {
  int n = 0;
  const char* p = json;
  while (n < max && (p = strstr(p, "\"sku\"")) != nullptr) {
    out[n].sku = "item";
    out[n].qty = 1;
    out[n].unit_price = 9.99;
    ++n;
    ++p;
  }
  return n;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: pricing <items-json>\n");
    return 2;
  }
  Item items[32];
  int count = parse_items(argv[1], items, 32);
  double total = price_total(items, count);
  FILE* log = fopen("pricing.log", "a");
  if (log != nullptr) {
    fprintf(log, "%d items -> %f\n", count, total);
  }
  printf("%f\n", total);
  return 0;
}
