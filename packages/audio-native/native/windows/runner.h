#pragma once
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <queue>
#include <thread>
#include "session.h"
namespace audio {
struct Input { std::mutex mutex; std::condition_variable wake; std::queue<std::string> lines; bool eof=false, invalid=false; };
inline void reader(std::shared_ptr<Input> input) {
  std::string line; char c;
  while (std::cin.get(c)) {
    if (c=='\n') { std::unique_lock<std::mutex> lock(input->mutex); if (input->lines.size()>=8) { input->invalid=true; input->wake.notify_one(); return; } input->lines.push(std::move(line)); line.clear(); input->wake.notify_one(); }
    else { if (line.size()>=audio::kMaxLine) { std::lock_guard<std::mutex> lock(input->mutex); input->invalid=true; input->wake.notify_one(); return; } line+=c; }
  }
  std::lock_guard<std::mutex> lock(input->mutex); if (!line.empty()) input->invalid=true; else input->eof=true; input->wake.notify_one();
}
inline int run_session(audio::Backend& backend) {
  auto input=std::make_shared<Input>(); std::thread(reader,input).detach(); uint64_t event_sequence=0;
  audio::Session session(backend,[&](const char* event) { std::cout << "{\"version\":1,\"sequence\":" << event_sequence++ << ",\"type\":\"" << event << "\"}\n" << std::flush; });
  while (!session.done()) {
    std::string line; bool eof=false, invalid=false, has_line=false;
    { std::unique_lock<std::mutex> lock(input->mutex); input->wake.wait_for(lock,std::chrono::milliseconds(10),[&]{ return !input->lines.empty() || input->eof || input->invalid; });
      if (input->invalid) invalid=true; else if (input->eof) eof=true; else if (!input->lines.empty()) { line=std::move(input->lines.front()); input->lines.pop(); has_line=true; }
    }
    if (invalid) session.invalid(); else if (has_line) { audio::Command command; if (!audio::parse_command(line,command)) session.invalid(); else session.command(command); } else if (eof) session.eof();
    session.tick();
  }
  return session.failed() ? 1 : 0;
}
}
