#include "window_stats.h"
#include <gtest/gtest.h>

TEST(WindowStats, MeanOfPushedValues) {
  Window w;
  w.size = 0;
  push_value(w, 10.0);
  push_value(w, 20.0);
  EXPECT_DOUBLE_EQ(window_mean(w), 13.5);
}

TEST(WindowStats, EmptyWindowIsZero) {
  Window w;
  w.size = 0;
  EXPECT_DOUBLE_EQ(window_mean(w), 0.0);
}
