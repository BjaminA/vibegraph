#include "packet.h"

#include <cstring>

// XOR checksum over the payload bytes.
uint8_t checksum(const uint8_t* bytes, int length) {
  uint8_t acc = 0;
  for (int i = 0; i < length; ++i) {
    acc ^= bytes[i];
  }
  return acc;
}

double scale(int32_t raw) {
  return raw / 100.0;
}

double scale(int32_t raw, double factor) {
  return raw * factor;
}

// Decode a 26-byte frame; false when the length or checksum is wrong.
bool decode_packet(const uint8_t* bytes, int length, Packet& out) {
  if (length != 26) {
    return false;
  }
  if (checksum(bytes, 25) != bytes[25]) {
    return false;
  }
  memcpy(out.device_id, bytes, 16);
  out.ts = static_cast<uint32_t>(bytes[16]) | (static_cast<uint32_t>(bytes[17]) << 8)
    | (static_cast<uint32_t>(bytes[18]) << 16) | (static_cast<uint32_t>(bytes[19]) << 24);
  out.metric = bytes[20];
  out.raw_value = static_cast<int32_t>(bytes[21]) | (static_cast<int32_t>(bytes[22]) << 8)
    | (static_cast<int32_t>(bytes[23]) << 16) | (static_cast<int32_t>(bytes[24]) << 24);
  out.checksum = bytes[25];
  return true;
}
