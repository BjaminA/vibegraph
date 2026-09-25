#include "router.h"

#include <algorithm>
#include <cstdio>
#include <sstream>
#include <stdexcept>

namespace net {

Sink::~Sink() = default;

LogSink::LogSink(std::string prefix) : prefix_(std::move(prefix)), delivered_(0) {}

LogSink::~LogSink() {
  std::printf("%s: delivered %d\n", prefix_.c_str(), delivered_);
}

Verdict LogSink::deliver(const Packet& p) {
  delivered_ += 1;
  std::printf("%s: %u %s\n", prefix_.c_str(), p.id, p.payload.c_str());
  return Verdict::Accept;
}

std::string LogSink::name() const {
  return prefix_;
}

Verdict DropSink::deliver(const Packet& p) {
  if (p.priority > 5) {
    return Verdict::Retry;
  }
  return Verdict::Drop;
}

std::string DropSink::name() const {
  return "drop";
}

Router::Router() : drained_(0) {}

Router::~Router() = default;

void Router::add_sink(const std::string& key, std::unique_ptr<Sink> sink) {
  sinks_[key] = std::move(sink);
}

// The single-argument overload picks a sink by priority band, then calls
// the virtual through the base pointer.
Verdict Router::route(const Packet& p) {
  const std::string key = p.priority > 5 ? "high" : "low";
  return route(p, key);
}

Verdict Router::route(const Packet& p, const std::string& key) {
  auto it = sinks_.find(key);
  if (it == sinks_.end()) {
    throw std::runtime_error("no sink for " + key);
  }
  // Dynamic dispatch through the base class: the target is decided at
  // runtime and the IR must say `dynamic`, never pick one override.
  return it->second->deliver(p);
}

int Router::drained() const {
  return drained_;
}

Packet Router::parse(const std::string& line) {
  std::istringstream in(line);
  Packet p{};
  std::string prio;
  if (!std::getline(in, prio, ':')) {
    throw std::runtime_error("malformed line");
  }
  p.id = static_cast<uint32_t>(std::stoul(prio));
  std::getline(in, p.payload, ':');
  std::string tail;
  std::getline(in, tail);
  p.priority = clamp_to<int>(tail.empty() ? 0 : std::stoi(tail), 0, 9);
  return p;
}

Router& Router::operator+=(const Packet& p) {
  queue_.push_back(p);
  return *this;
}

const char* verdict_name(Verdict v) {
  switch (v) {
    case Verdict::Accept:
      return "accept";
    case Verdict::Drop:
      return "drop";
    case Verdict::Retry:
      return "retry";
  }
  return "unknown";
}

}  // namespace net
