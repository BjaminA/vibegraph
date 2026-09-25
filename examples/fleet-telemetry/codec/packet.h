// Sensor packet codec — the on-device wire format the ingest pipeline
// receives after the edge decodes it. `scale` is overloaded on purpose:
// VibeGraph's C++ linker refuses to pick, so the call reads as an honest
// resolution gap.
#pragma once

#include <cstdint>

struct Packet {
  char device_id[16];
  uint32_t ts;
  uint8_t metric;
  int32_t raw_value;
  uint8_t checksum;
};

uint8_t checksum(const uint8_t* bytes, int length);
double scale(int32_t raw);
double scale(int32_t raw, double factor);
bool decode_packet(const uint8_t* bytes, int length, Packet& out);
