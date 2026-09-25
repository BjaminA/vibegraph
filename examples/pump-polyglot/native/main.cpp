// window_stats CLI: reads the wear column from a pump CSV and prints the
// rolling mean. Built and run by ops/pipeline.sh — a cross-language hop
// neither side can link statically; each names it honestly.
#include "window_stats.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

static double last_column(const char* line) {
  const char* comma = strrchr(line, ',');
  return comma ? atof(comma + 1) : atof(line);
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: window_stats <pump.csv>\n");
    return 2;
  }
  FILE* csv = fopen(argv[1], "r");
  if (csv == nullptr) {
    fprintf(stderr, "cannot open %s\n", argv[1]);
    return 1;
  }
  Window w;
  w.size = 0;
  char line[512];
  int header = 1;
  while (fgets(line, sizeof line, csv) != nullptr) {
    if (header) {
      header = 0;
      continue;
    }
    push_value(w, last_column(line));
  }
  fclose(csv);
  printf("rolling wear mean %f over %d rows\n", window_mean(w), w.size);
  return 0;
}
