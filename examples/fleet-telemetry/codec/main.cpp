// decode CLI: reads raw frames from a capture file and prints one line
// per valid packet. The ops deploy script builds it; nothing links to it
// statically from the Python side.
#include "packet.h"

#include <cstdio>
#include <cstdlib>

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: decode <capture.bin>\n");
    return 2;
  }
  FILE* capture = fopen(argv[1], "rb");
  if (capture == nullptr) {
    fprintf(stderr, "cannot open %s\n", argv[1]);
    return 1;
  }
  uint8_t frame[26];
  int good = 0;
  int bad = 0;
  while (fread(frame, 1, sizeof frame, capture) == sizeof frame) {
    Packet p;
    if (decode_packet(frame, sizeof frame, p)) {
      printf("%.16s %u %u %f\n", p.device_id, p.ts, p.metric, scale(p.raw_value));
      ++good;
    } else {
      ++bad;
    }
  }
  fclose(capture);
  fprintf(stderr, "decoded %d packets, %d rejected\n", good, bad);
  return bad > 0 ? 3 : 0;
}
