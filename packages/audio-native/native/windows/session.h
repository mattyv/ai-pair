#pragma once
#include "protocol.h"
#include <functional>
namespace audio {
struct Backend {
  virtual ~Backend() = default;
  virtual bool open(const std::string&) = 0;
  virtual bool start(const std::vector<unsigned char>&, size_t, size_t) = 0;
  virtual bool pause() = 0;
  virtual bool resume() = 0;
  virtual int pump() = 0;
  virtual bool healthy() = 0;
  // Always releases the stream and its resources before returning. False means
  // a stop or reset operation failed, not that the stream remains owned.
  virtual bool close() = 0;
};
class Session {
 public:
  Session(Backend& backend, std::function<void(const char*)> emit) : backend_(backend), emit_(emit) {}
  bool done() const { return state_ == State::done; }
  void command(const Command& c) {
    if (done()) return;
    if (c.sequence != next_++) { finish("failed"); return; }
    // LocalAudioOwnership: Reserve snapshots the exact endpoint before playback.
    if (state_ == State::initial && c.type == "open") {
      if (!backend_.open(c.value)) { finish("failed"); return; }
      state_=State::ready; emit_("ready"); return;
    }
    if (state_ == State::ready && c.type == "play") {
      size_t offset=0, length=0;
      if (!decode_base64(c.value, wav_) || !parse_wav(wav_,offset,length) || !backend_.start(wav_,offset,length)) { finish("failed"); return; }
      state_=State::playing; emit_("started"); return;
    }
    // LocalAudioOwnership: Cancel retains ownership until the stream is released.
    if (c.type == "stop" && state_ != State::initial) { finish("canceled"); return; }
    if (c.type == "pause" && state_ == State::playing) { if (!backend_.pause()) { finish("failed"); return; } state_=State::paused; emit_("paused"); return; }
    if (c.type == "resume" && state_ == State::paused) { if (!backend_.resume()) { finish("failed"); return; } state_=State::playing; emit_("resumed"); return; }
    finish("failed");
  }
  void tick() {
    if (state_ == State::paused) { if (!backend_.healthy()) finish("failed"); return; }
    if (state_ != State::playing) return;
    int result=backend_.pump();
    if (result < 0) finish("failed");
    else if (result > 0) finish("ended");
  }
  void eof() { if (!done()) finish("canceled"); }
  void invalid() { if (!done()) finish("failed"); }
 private:
  enum class State { initial, ready, playing, paused, done };
  void finish(const char* outcome) { bool closed=backend_.close(); state_=State::done; emit_(closed ? outcome : "failed"); emit_("retired"); }
  Backend& backend_; std::function<void(const char*)> emit_; State state_=State::initial; uint64_t next_=0; std::vector<unsigned char> wav_;
};
}
