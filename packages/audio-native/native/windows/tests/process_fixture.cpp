#include "../runner.h"
struct Fake : audio::Backend {
  bool open(const std::string& id) override { return id == "valid"; }
  bool start(const std::vector<unsigned char>&, size_t, size_t) override { return true; }
  bool pause() override { return true; }
  bool resume() override { return true; }
  int pump() override { return 0; }
  bool healthy() override { return true; }
  bool close() override { return true; }
};
int main() { Fake fake; return audio::run_session(fake); }
