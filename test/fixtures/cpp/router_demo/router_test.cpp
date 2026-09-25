#include "router.h"

#include <gtest/gtest.h>

#include <memory>
#include <string>

TEST(RouterSuite, ClampHoldsTheBand) {
  EXPECT_EQ(net::clamp_to<int>(12, 0, 9), 9);
  EXPECT_EQ(net::clamp_to<int>(-3, 0, 9), 0);
  EXPECT_EQ(net::clamp_to<int>(4, 0, 9), 4);
}

TEST(RouterSuite, ParseSplitsOnColons) {
  net::Packet p = net::Router::parse("7:hello:3");
  EXPECT_EQ(p.id, 7u);
  EXPECT_EQ(p.payload, "hello");
  EXPECT_EQ(p.priority, 3);
}

TEST(RouterSuite, UnknownSinkThrows) {
  net::Router r;
  net::Packet p{1, "x", 1};
  EXPECT_THROW(r.route(p, "nope"), std::runtime_error);
}
