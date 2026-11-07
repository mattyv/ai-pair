#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>
#include <algorithm>
#include <condition_variable>
#include <chrono>
#include <cstdio>
#include <iostream>
#include <memory>
#include <mutex>
#include <queue>
#include <thread>
#include "session.h"

namespace {
template<class T> class Com {
 public:
  ~Com() { reset(); }
  T* get() const { return ptr_; }
  T** put() { reset(); return &ptr_; }
  T* operator->() const { return ptr_; }
  void reset() { if (ptr_) { ptr_->Release(); ptr_=nullptr; } }
 private: T* ptr_=nullptr;
};
std::string to_utf8(const wchar_t* str) {
  if (!str) return {};
  int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,str,-1,nullptr,0,nullptr,nullptr);
  if (n<=0) return {};
  std::string result(static_cast<size_t>(n), '\0');
  if (!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,str,-1,&result[0],n,nullptr,nullptr)) return {};
  result.pop_back(); return result;
}
std::wstring to_wide(const std::string& str) {
  int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,str.data(),static_cast<int>(str.size()),nullptr,0);
  if (n<=0) return {};
  std::wstring result(static_cast<size_t>(n),L'\0');
  if (!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,str.data(),static_cast<int>(str.size()),&result[0],n)) return {};
  return result;
}
std::string quote(const std::string& str) {
  static const char hex[]="0123456789abcdef"; std::string result="\"";
  for (unsigned char c : str) { if (c=='"' || c=='\\') { result+='\\'; result+=static_cast<char>(c); } else if (c<32) { result+="\\u00"; result+=hex[c>>4]; result+=hex[c&15]; } else result+=static_cast<char>(c); }
  return result+'"';
}
bool enumerator(Com<IMMDeviceEnumerator>& out) { return SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,__uuidof(IMMDeviceEnumerator),reinterpret_cast<void**>(out.put()))); }
std::string device_id(IMMDevice* device) { LPWSTR id=nullptr; if (FAILED(device->GetId(&id))) return {}; std::string result=to_utf8(id); CoTaskMemFree(id); return result; }
int list() {
  Com<IMMDeviceEnumerator> enumer; Com<IMMDeviceCollection> devices;
  if (!enumerator(enumer) || FAILED(enumer->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,devices.put()))) return 1;
  UINT count=0; if (FAILED(devices->GetCount(&count))) return 1;
  Com<IMMDevice> def; std::string default_id;
  if (SUCCEEDED(enumer->GetDefaultAudioEndpoint(eRender,eConsole,def.put()))) default_id=device_id(def.get());
  std::string entries; bool found_default=false; unsigned accepted=0;
  for (UINT i=0;i<count && accepted<64;i++) {
    Com<IMMDevice> device; Com<IPropertyStore> properties; PROPVARIANT label; PropVariantInit(&label);
    if (FAILED(devices->Item(i,device.put())) || FAILED(device->OpenPropertyStore(STGM_READ,properties.put()))) continue;
    HRESULT hr=properties->GetValue(PKEY_Device_FriendlyName,&label);
    std::string id=device_id(device.get()); std::string name=(SUCCEEDED(hr) && label.vt==VT_LPWSTR) ? to_utf8(label.pwszVal) : std::string(); PropVariantClear(&label);
    if (id.empty() || id.size()>512 || name.size()>256) continue;
    std::string entry="{\"id\":"+quote(id)+",\"label\":"+quote(name)+"}";
    if (entries.size()+entry.size()+1024>65536) break;
    if (accepted++) entries+=','; entries+=entry; if (id==default_id) found_default=true;
  }
  std::cout << "{\"version\":1,\"devices\":[" << entries << "],\"defaultId\":" << (found_default ? quote(default_id) : "null") << "}\n"; return std::cout ? 0 : 1;
}
class Wasapi : public audio::Backend {
 public:
  bool open(const std::string& id) override {
    std::wstring wide=to_wide(id); if (wide.empty() || !enumerator(enumer_)) return false;
    if (FAILED(enumer_->GetDevice(wide.c_str(),device_.put()))) return false;
    DWORD state=0; if (FAILED(device_->GetState(&state)) || state!=DEVICE_STATE_ACTIVE) return false;
    Com<IMMEndpoint> endpoint; EDataFlow flow;
    if (FAILED(device_->QueryInterface(__uuidof(IMMEndpoint),reinterpret_cast<void**>(endpoint.put()))) || FAILED(endpoint->GetDataFlow(&flow)) || flow!=eRender) return false;
    if (FAILED(device_->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(client_.put())))) return false;
    WAVEFORMATEX format={}; format.wFormatTag=WAVE_FORMAT_PCM; format.nChannels=1; format.nSamplesPerSec=24000; format.wBitsPerSample=16; format.nBlockAlign=2; format.nAvgBytesPerSec=48000;
    DWORD flags=AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    if (FAILED(client_->Initialize(AUDCLNT_SHAREMODE_SHARED,flags,0,0,&format,nullptr)) || FAILED(client_->GetBufferSize(&capacity_)) || !capacity_) return false;
    return SUCCEEDED(client_->GetService(__uuidof(IAudioRenderClient),reinterpret_cast<void**>(render_.put())));
  }
  bool start(const std::vector<unsigned char>& wav, size_t offset, size_t length) override {
    data_=wav.data()+offset; frames_=length/2; position_=0;
    if (write_available()<0) return false;
    return SUCCEEDED(client_->Start());
  }
  bool pause() override { return SUCCEEDED(client_->Stop()); }
  bool resume() override { return SUCCEEDED(client_->Start()); }
  int pump() override { return write_available(); }
  bool healthy() override { DWORD state=0; return device_.get() && SUCCEEDED(device_->GetState(&state)) && state==DEVICE_STATE_ACTIVE; }
  bool close() override {
    bool ok=true;
    if (client_.get()) { if (FAILED(client_->Stop())) ok=false; if (FAILED(client_->Reset())) ok=false; }
    render_.reset(); client_.reset(); device_.reset(); enumer_.reset(); data_=nullptr; return ok;
  }
 private:
  int write_available() {
    UINT32 padding=0; if (FAILED(client_->GetCurrentPadding(&padding)) || padding>capacity_) return -1;
    if (position_==frames_) return padding==0 ? 1 : 0;
    UINT32 n=static_cast<UINT32>(std::min<size_t>(capacity_-padding,frames_-position_));
    if (!n) return 0;
    BYTE* buffer=nullptr; if (FAILED(render_->GetBuffer(n,&buffer))) return -1;
    std::memcpy(buffer,data_+position_*2,static_cast<size_t>(n)*2);
    if (FAILED(render_->ReleaseBuffer(n,0))) return -1;
    position_+=n; return 0;
  }
  Com<IMMDeviceEnumerator> enumer_; Com<IMMDevice> device_; Com<IAudioClient> client_; Com<IAudioRenderClient> render_;
  const unsigned char* data_=nullptr; size_t frames_=0, position_=0; UINT32 capacity_=0;
};
struct Input { std::mutex mutex; std::condition_variable wake; std::queue<std::string> lines; bool eof=false, invalid=false; };
void reader(std::shared_ptr<Input> input) {
  std::string line; char c;
  while (std::cin.get(c)) {
    if (c=='\n') { std::unique_lock<std::mutex> lock(input->mutex); if (input->lines.size()>=8) { input->invalid=true; input->wake.notify_one(); return; } input->lines.push(std::move(line)); line.clear(); input->wake.notify_one(); }
    else { if (line.size()>=audio::kMaxLine) { std::lock_guard<std::mutex> lock(input->mutex); input->invalid=true; input->wake.notify_one(); return; } line+=c; }
  }
  std::lock_guard<std::mutex> lock(input->mutex); if (!line.empty()) input->invalid=true; else input->eof=true; input->wake.notify_one();
}
int play() {
  auto input=std::make_shared<Input>(); std::thread(reader,input).detach(); Wasapi backend; uint64_t event_sequence=0;
  audio::Session session(backend,[&](const char* event) { std::cout << "{\"version\":1,\"sequence\":" << event_sequence++ << ",\"type\":\"" << event << "\"}\n" << std::flush; });
  while (!session.done()) {
    std::string line; bool eof=false, invalid=false, has_line=false;
    { std::unique_lock<std::mutex> lock(input->mutex); input->wake.wait_for(lock,std::chrono::milliseconds(10),[&]{ return !input->lines.empty() || input->eof || input->invalid; });
      if (input->invalid) invalid=true; else if (input->eof) eof=true; else if (!input->lines.empty()) { line=std::move(input->lines.front()); input->lines.pop(); has_line=true; }
    }
    if (invalid) session.invalid(); else if (has_line) { audio::Command command; if (!audio::parse_command(line,command)) session.invalid(); else session.command(command); } else if (eof) session.eof();
    session.tick();
  }
  return 0;
}
}
int main(int argc, char** argv) {
  if (argc!=2 || (std::strcmp(argv[1],"--list") && std::strcmp(argv[1],"--play"))) return 2;
  if (FAILED(CoInitializeEx(nullptr,COINIT_MULTITHREADED))) return 1;
  int result=std::strcmp(argv[1],"--list")==0 ? list() : play(); CoUninitialize(); return result;
}
