// Rolling window statistics over the pump CSV — the C++ tool the
// pipeline builds and runs. `smooth` is OVERLOADED on purpose: VibeGraph's
// C++ linker refuses to pick between the two, so the call reads as an
// honest resolution gap rather than a guessed edge.
#pragma once

struct Window {
  double values[64];
  int size;
};

double window_mean(const Window& w);
double smooth(double value);
double smooth(double value, double alpha);
int push_value(Window& w, double value);
