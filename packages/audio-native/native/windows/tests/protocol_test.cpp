#include "../protocol.h"
#include <cassert>
#include <string>
#include <vector>
using namespace audio;
int main() {
  Command c;
  assert(parse_command(R"({"version":1,"sequence":0,"type":"open","id":"device\u0020one"})", c));
  assert(c.type == "open" && c.value == "device one");
  assert(!parse_command(R"({"version":1,"sequence":0,"type":"open","id":"x","id":"y"})", c));
  assert(!parse_command(R"({"version":1,"sequence":0,"type":"stop","id":"x"})", c));
  assert(!parse_command(R"({"version":1,"sequence":01,"type":"stop"})", c));
  assert(!parse_command(std::string(R"({"version":1,"sequence":0,"type":"open","id":")") + char(92) + "ud800" + R"("})", c));
  assert(!parse_command(std::string("{\"version\":1,\"sequence\":0,\"type\":\"open\",\"id\":\"") + std::string(513,'a') + "\"}", c));
  std::vector<unsigned char> bytes;
  assert(decode_base64("AAEC/w==", bytes) && bytes == std::vector<unsigned char>({0,1,2,255}));
  assert(!decode_base64("AB==", bytes));
  assert(!decode_base64("AA=A", bytes));
  assert(!decode_base64("AA==AAAA", bytes));
  std::vector<unsigned char> wav = {'R','I','F','F',38,0,0,0,'W','A','V','E','f','m','t',' ',16,0,0,0,1,0,1,0,192,93,0,0,128,187,0,0,2,0,16,0,'d','a','t','a',2,0,0,0,0,0};
  size_t offset = 0, length = 0;
  assert(parse_wav(wav, offset, length) && offset == 44 && length == 2);
  wav[22] = 2; assert(!parse_wav(wav, offset, length));
  wav[22] = 1; wav.pop_back(); assert(!parse_wav(wav, offset, length));
  return 0;
}
