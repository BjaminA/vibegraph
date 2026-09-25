#include "packet.h"
#include <gtest/gtest.h>

TEST(Codec, ChecksumIsXor) {
  uint8_t bytes[3] = {0x01, 0x02, 0x04};
  EXPECT_EQ(checksum(bytes, 3), 0x07);
}

TEST(Codec, RejectsWrongLength) {
  uint8_t bytes[10] = {0};
  Packet p;
  EXPECT_FALSE(decode_packet(bytes, 10, p));
}
