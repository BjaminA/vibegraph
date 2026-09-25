// A small packet router, written to exercise the C++ constructs the
// geometry_demo fixture does not: a namespace, inheritance with virtual
// dispatch, a template, an operator overload, a static method, a
// destructor, STL containers, a lambda, a switch, do-while, and a
// reference parameter. Every one of those is a thing the thread view has
// to render a node for, or honestly decline to.
#ifndef ROUTER_H
#define ROUTER_H

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace net {

enum class Verdict { Accept, Drop, Retry };

struct Packet {
  uint32_t id;
  std::string payload;
  int priority;
};

// A sink is chosen at runtime through a base pointer: the call through it
// is genuine dynamic dispatch, not a resolution gap.
class Sink {
 public:
  virtual ~Sink();
  virtual Verdict deliver(const Packet& p) = 0;
  virtual std::string name() const = 0;
};

class LogSink : public Sink {
 public:
  explicit LogSink(std::string prefix);
  ~LogSink() override;
  Verdict deliver(const Packet& p) override;
  std::string name() const override;

 private:
  std::string prefix_;
  int delivered_;
};

class DropSink : public Sink {
 public:
  Verdict deliver(const Packet& p) override;
  std::string name() const override;
};

class Router {
 public:
  Router();
  ~Router();

  void add_sink(const std::string& key, std::unique_ptr<Sink> sink);
  // Overloaded on purpose: a bare `route` call cannot be resolved to one
  // definition, so the thread must render it `unresolved`, not guess.
  Verdict route(const Packet& p);
  Verdict route(const Packet& p, const std::string& key);

  int drained() const;
  static Packet parse(const std::string& line);

  // Operator overload: a call site spelled `r += p`.
  Router& operator+=(const Packet& p);

 private:
  std::map<std::string, std::unique_ptr<Sink>> sinks_;
  std::vector<Packet> queue_;
  int drained_;
};

// A template the parser must keep as a template, and whose call sites
// keep their <T>.
template <typename T>
T clamp_to(T value, T lo, T hi) {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}

const char* verdict_name(Verdict v);

}  // namespace net

#endif  // ROUTER_H
