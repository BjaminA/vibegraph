#include "window_stats.h"

// Mean of every value currently in the window.
double window_mean(const Window& w) {
  double total = 0.0;
  for (int i = 0; i < w.size; ++i) {
    total += w.values[i];
  }
  return w.size > 0 ? total / w.size : 0.0;
}

double smooth(double value) {
  return value * 0.9;
}

double smooth(double value, double alpha) {
  return value * (1.0 - alpha);
}

// Append a smoothed value; returns the new size (drops the oldest when full).
int push_value(Window& w, double value) {
  if (w.size == 64) {
    for (int i = 1; i < 64; ++i) {
      w.values[i - 1] = w.values[i];
    }
    w.size = 63;
  }
  w.values[w.size] = smooth(value);
  w.size += 1;
  return w.size;
}
