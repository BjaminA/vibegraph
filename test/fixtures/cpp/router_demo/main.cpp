#include "router.h"

#include <cstdio>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// The cli entry. Reaches a file read, a classic for, a range-for, a
// do-while, a lambda, a try/catch, a throw, an overload the linker
// cannot pick, and a virtual call it must call dynamic.
int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: router <packets.txt>\n");
    return 2;
  }

  net::Router router;
  router.add_sink("low", std::make_unique<net::DropSink>());
  router.add_sink("high", std::make_unique<net::LogSink>("high"));

  std::ifstream input(argv[1]);
  if (!input) {
    std::fprintf(stderr, "cannot open %s\n", argv[1]);
    return 1;
  }

  std::vector<std::string> lines;
  std::string line;
  while (std::getline(input, line)) {
    if (!line.empty()) {
      lines.push_back(line);
    }
  }

  // A lambda: the call inside it runs when the lambda is CALLED, which is
  // here, immediately.
  auto describe = [](const net::Packet& p) {
    std::printf("packet %u priority %d\n", p.id, p.priority);
  };

  int accepted = 0;
  int failed = 0;
  for (size_t i = 0; i < lines.size(); ++i) {
    try {
      net::Packet p = net::Router::parse(lines[i]);
      describe(p);
      // Overloaded: two definitions of `route`, so this stays unresolved.
      net::Verdict v = router.route(p);
      std::printf("-> %s\n", net::verdict_name(v));
      if (v == net::Verdict::Accept) {
        accepted += 1;
      }
    } catch (const std::runtime_error& e) {
      std::fprintf(stderr, "line %zu: %s\n", i, e.what());
      failed += 1;
    }
  }

  // A range-for over the same data, feeding the operator overload.
  for (const std::string& raw : lines) {
    if (raw.size() > 3) {
      router += net::Router::parse(raw);
    }
  }

  // do-while: the body runs before the test.
  int retries = 0;
  do {
    retries += 1;
  } while (retries < accepted && retries < 3);

  std::printf("accepted %d failed %d retries %d drained %d\n",
              accepted, failed, retries, router.drained());
  return failed > 0 ? 1 : 0;
}
