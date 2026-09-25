#include "pricing.h"
#include <gtest/gtest.h>

TEST(Pricing, LineTotal) {
  Item item{"sku-1", 3, 2.0};
  EXPECT_DOUBLE_EQ(line_total(item), 6.0);
}

TEST(Pricing, DiscountApplied) {
  Item items[2] = {{"a", 1, 10.0}, {"b", 1, 10.0}};
  EXPECT_DOUBLE_EQ(price_total(items, 2), 19.0);
}
