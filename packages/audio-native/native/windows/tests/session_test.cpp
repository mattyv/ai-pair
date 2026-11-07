#include "../session.h"
#include <cassert>
#include <string>
#include <vector>
using namespace audio;
struct Fake : Backend {
  bool opened=false, playing=false, paused=false, closed=false, fail=false; int pending=1;
  bool open(const std::string&) override { opened=!fail; return opened; }
  bool start(const std::vector<unsigned char>&, size_t, size_t) override { playing=!fail; return playing; }
  bool pause() override { paused=true; return !fail; }
  bool resume() override { paused=false; return !fail; }
  int pump() override { return fail ? -1 : pending; }
  bool healthy() override { return !fail; }
  bool close() override { closed=true; return true; }
};
static Command cmd(uint64_t n, const char* type, const char* value="") { Command c; c.sequence=n; c.type=type; c.value=value; return c; }
int main() {
  { Fake b; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","a")); assert(events == std::vector<std::string>({"ready"}));
    s.command(cmd(1,"stop")); assert(b.closed && events == std::vector<std::string>({"ready","canceled","retired"})); }
  { Fake b; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(1,"open","a")); assert(b.closed && events == std::vector<std::string>({"failed","retired"})); }
  { Fake b; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","a")); s.command(cmd(1,"play","invalid")); assert(b.closed && events == std::vector<std::string>({"ready","failed","retired"})); }
  { Fake b; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","a")); s.eof(); assert(b.closed && events == std::vector<std::string>({"ready","canceled","retired"})); }
  const char* wav="UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==";
  { Fake b; b.pending=0; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","a")); s.command(cmd(1,"play",wav)); s.tick();
    assert(events == std::vector<std::string>({"ready","started"}));
    s.command(cmd(2,"pause")); assert(b.paused); s.tick();
    s.command(cmd(3,"resume")); assert(!b.paused); b.pending=1; s.tick();
    assert(b.closed && events == std::vector<std::string>({"ready","started","paused","resumed","ended","retired"})); }
  { Fake b; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","a")); s.command(cmd(1,"play",wav)); s.command(cmd(2,"pause")); s.eof();
    assert(b.closed && events == std::vector<std::string>({"ready","started","paused","canceled","retired"})); }
  { Fake b; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","a")); s.command(cmd(1,"play",wav)); s.command(cmd(2,"pause")); b.fail=true; s.tick();
    assert(b.closed && events == std::vector<std::string>({"ready","started","paused","failed","retired"})); }
  { Fake b; b.fail=true; std::vector<std::string> events; Session s(b,[&](const char* e){events.emplace_back(e);});
    s.command(cmd(0,"open","missing")); assert(b.closed && events == std::vector<std::string>({"failed","retired"})); }
  return 0;
}
