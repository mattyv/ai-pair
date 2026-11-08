#pragma once
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <string>
#include <vector>

namespace audio {
constexpr size_t kMaxWav = 1948844;
constexpr size_t kMaxLine = ((kMaxWav + 2) / 3) * 4 + 256;
struct Command { uint64_t sequence = 0; std::string type, value; };

inline bool utf8(const std::string& s) {
  for (size_t i = 0; i < s.size();) {
    unsigned char a = static_cast<unsigned char>(s[i++]);
    if (a < 0x80) continue;
    unsigned count = a >= 0xc2 && a <= 0xdf ? 1 : a >= 0xe0 && a <= 0xef ? 2 : a >= 0xf0 && a <= 0xf4 ? 3 : 0;
    if (!count || i + count > s.size()) return false;
    unsigned cp = a & (0x7f >> count);
    for (unsigned n = 0; n < count; ++n) { unsigned char b = static_cast<unsigned char>(s[i++]); if ((b & 0xc0) != 0x80) return false; cp = (cp << 6) | (b & 0x3f); }
    if ((count == 2 && cp < 0x800) || (count == 3 && cp < 0x10000) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
  }
  return true;
}
inline void append_utf8(std::string& out, unsigned cp) {
  if (cp < 0x80) out += static_cast<char>(cp);
  else if (cp < 0x800) { out += static_cast<char>(0xc0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 63)); }
  else if (cp < 0x10000) { out += static_cast<char>(0xe0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 63)); out += static_cast<char>(0x80 | (cp & 63)); }
  else { out += static_cast<char>(0xf0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 63)); out += static_cast<char>(0x80 | ((cp >> 6) & 63)); out += static_cast<char>(0x80 | (cp & 63)); }
}
class Parser {
 public:
  explicit Parser(const std::string& s) : s_(s) {}
  void ws() { while (p_ < s_.size() && (s_[p_] == ' ' || s_[p_] == '\t' || s_[p_] == '\r')) ++p_; }
  bool take(char c) { ws(); if (p_ == s_.size() || s_[p_] != c) return false; ++p_; return true; }
  bool done() { ws(); return p_ == s_.size(); }
  bool number(uint64_t& n) {
    ws(); if (p_ == s_.size() || s_[p_] < '0' || s_[p_] > '9') return false;
    if (s_[p_] == '0' && p_ + 1 < s_.size() && s_[p_+1] >= '0' && s_[p_+1] <= '9') return false;
    n = 0; while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') { unsigned d = s_[p_++] - '0'; if (n > (UINT64_MAX - d) / 10) return false; n = n * 10 + d; } return true;
  }
  bool hex(unsigned& n) { n = 0; for (int i = 0; i < 4; ++i) { if (p_ == s_.size()) return false; char c = s_[p_++]; unsigned v = c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : c >= 'A' && c <= 'F' ? c-'A'+10 : 16; if (v == 16) return false; n = n*16+v; } return true; }
  bool string(std::string& out) {
    if (!take('"')) return false;
    out.clear();
    while (p_ < s_.size()) { unsigned char c = static_cast<unsigned char>(s_[p_++]); if (c == '"') return utf8(out); if (c < 0x20) return false;
      if (c != '\\') { out += static_cast<char>(c); continue; } if (p_ == s_.size()) return false; char e = s_[p_++];
      if (e == '"' || e == '\\' || e == '/') out += e;
      else if (e == 'b') out += '\b'; else if (e == 'f') out += '\f'; else if (e == 'n') out += '\n'; else if (e == 'r') out += '\r'; else if (e == 't') out += '\t';
      else if (e == 'u') { unsigned cp; if (!hex(cp)) return false; if (cp >= 0xd800 && cp <= 0xdbff) { if (p_+2 > s_.size() || s_[p_++] != '\\' || s_[p_++] != 'u') return false; unsigned low; if (!hex(low) || low < 0xdc00 || low > 0xdfff) return false; cp = 0x10000 + ((cp-0xd800)<<10) + low-0xdc00; } else if (cp >= 0xdc00 && cp <= 0xdfff) return false; append_utf8(out, cp); }
      else return false;
    } return false;
  }
 private: const std::string& s_; size_t p_ = 0;
};
inline bool parse_command(const std::string& line, Command& cmd) {
  if (line.size() > kMaxLine || !utf8(line)) return false;
  Parser p(line); if (!p.take('{')) return false;
  bool version=false, sequence=false, type=false, value=false; std::string valkey;
  do { std::string key; if (!p.string(key) || !p.take(':')) return false;
    if (key == "version") { uint64_t n; if (version || !p.number(n) || n != 1) return false; version=true; }
    else if (key == "sequence") { if (sequence || !p.number(cmd.sequence)) return false; sequence=true; }
    else if (key == "type") { if (type || !p.string(cmd.type)) return false; type=true; }
    else if (key == "id" || key == "wav") { if (value || !p.string(cmd.value)) return false; value=true; valkey=key; }
    else return false;
    if (p.take('}')) break;
    if (!p.take(',')) return false;
  } while (true);
  if (!p.done() || !version || !sequence || !type) return false;
  if (cmd.type == "open") return value && valkey == "id" && !cmd.value.empty() && cmd.value.size() <= 512 && cmd.value.find('\0') == std::string::npos;
  if (cmd.type == "play") return value && valkey == "wav" && cmd.value.size() <= ((kMaxWav + 2) / 3) * 4;
  return !value && (cmd.type == "pause" || cmd.type == "resume" || cmd.type == "stop");
}
inline bool decode_base64(const std::string& in, std::vector<unsigned char>& out) {
  out.clear(); if (in.size() % 4 || in.size() > ((kMaxWav+2)/3)*4) return false;
  auto val=[](char c)->int { if(c>='A'&&c<='Z') return c-'A'; if(c>='a'&&c<='z') return c-'a'+26; if(c>='0'&&c<='9') return c-'0'+52; if(c=='+') return 62; if(c=='/') return 63; return -1; };
  for (size_t i=0;i<in.size();i+=4) { int a=val(in[i]), b=val(in[i+1]); int c=in[i+2]=='=' ? -2 : val(in[i+2]); int d=in[i+3]=='=' ? -2 : val(in[i+3]); if(a<0||b<0||c==-1||d==-1 || (c==-2 && d!=-2) || ((c==-2 || d==-2) && i+4!=in.size()) || (c==-2 && (b&15)) || (d==-2 && c>=0 && (c&3))) return false;
    out.push_back(static_cast<unsigned char>((a<<2)|(b>>4))); if(c>=0) out.push_back(static_cast<unsigned char>((b<<4)|(c>>2))); if(d>=0) out.push_back(static_cast<unsigned char>((c<<6)|d));
  } return out.size() <= kMaxWav;
}
inline uint32_t u32(const std::vector<unsigned char>& b, size_t p) { return uint32_t(b[p]) | (uint32_t(b[p+1])<<8) | (uint32_t(b[p+2])<<16) | (uint32_t(b[p+3])<<24); }
inline bool parse_wav(const std::vector<unsigned char>& b, size_t& offset, size_t& length) {
  if (b.size()<44 || b.size()>kMaxWav || std::memcmp(b.data(),"RIFF",4) || std::memcmp(b.data()+8,"WAVE",4) || u32(b,4)!=b.size()-8) return false;
  bool format=false, data=false; size_t p=12;
  while (p+8<=b.size()) { uint32_t n=u32(b,p+4); size_t start=p+8; if(n>b.size()-start) return false;
    if(!std::memcmp(b.data()+p,"fmt ",4)) { if(format || n<16 || b[start]!=1 || b[start+1]!=0 || b[start+2]!=1 || b[start+3]!=0 || u32(b,start+4)!=24000 || u32(b,start+8)!=48000 || b[start+12]!=2 || b[start+13]!=0 || b[start+14]!=16 || b[start+15]!=0) return false; format=true; }
    if(!std::memcmp(b.data()+p,"data",4)) { if(data || !n || (n&1)) return false; offset=start; length=n; data=true; }
    size_t padded=static_cast<size_t>(n)+(n&1); if(padded>b.size()-start) return false; p=start+padded;
  } return p==b.size() && format && data;
}
}
