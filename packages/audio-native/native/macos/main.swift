import AudioToolbox
import CoreAudio
import Darwin
import Foundation

// Wire protocol v1: one process owns one exact output, never a fallback route.
private let maxLine = 2_600_000
private let maxWav = 1_948_844
private let maxDevices = 64
private var eventSequence = 0
private let outputLock = NSLock()

private func event(_ name: String) {
  outputLock.lock()
  defer { outputLock.unlock() }
  let line = "{\"version\":1,\"sequence\":\(eventSequence),\"type\":\"\(name)\"}\n"
  eventSequence += 1
  FileHandle.standardOutput.write(Data(line.utf8))
}

private func propertyString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var result: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &result) == noErr else { return nil }
  return result as String
}

private func outputs() -> ([(String, String)], String?)? {
  var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  let system = AudioObjectID(kAudioObjectSystemObject)
  guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else { return nil }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return nil }
  var defaultAddress = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var defaultDevice: AudioDeviceID = 0
  var defaultSize = UInt32(MemoryLayout<AudioDeviceID>.size)
  let gotDefault = AudioObjectGetPropertyData(system, &defaultAddress, 0, nil, &defaultSize, &defaultDevice) == noErr
  var devices: [(String, String)] = []
  var defaultID: String?
  for device in ids {
    var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
    var streamSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &streams, 0, nil, &streamSize) == noErr, streamSize > 0,
      let uid = propertyString(device, kAudioDevicePropertyDeviceUID), !uid.isEmpty, uid.utf8.count <= 512,
      let label = propertyString(device, kAudioObjectPropertyName), label.utf8.count <= 256 else { continue }
    if gotDefault && device == defaultDevice { defaultID = uid }
    if devices.count < maxDevices { devices.append((uid, label)) }
  }
  if let id = defaultID, !devices.contains(where: { $0.0 == id }) { defaultID = nil }
  return (devices, defaultID)
}

private func list() -> Never {
  guard let (devices, defaultID) = outputs() else { exit(1) }
  let entries = devices.map { ["id": $0.0, "label": $0.1] }
  let value: [String: Any] = ["version": 1, "devices": entries, "defaultId": defaultID as Any? ?? NSNull()]
  guard let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 65_535 else { exit(1) }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([10]))
  exit(0)
}

// Strict, bounded line framing; the reader stays running while playback is paused.
private func lines(_ receive: (Data) -> Bool) {
  var pending = Data()
  while true {
    let chunk = try? FileHandle.standardInput.read(upToCount: 4096)
    guard let chunk, !chunk.isEmpty else { return }
    for byte in chunk {
      if byte == 10 {
        if !receive(pending) { return }
        pending.removeAll(keepingCapacity: true)
      } else {
        if pending.count >= maxLine { return }
        pending.append(byte)
      }
    }
  }
}

private final class Player {
  private var queue: AudioQueueRef?
  private var sequence = 0
  private var playing = false
  private var paused = false
  private var draining = false
  private var terminal = false
  private let lock = NSLock()

  private func finish(_ outcome: String) {
    lock.lock()
    guard !terminal else { lock.unlock(); return }
    terminal = true
    let current = queue
    queue = nil
    lock.unlock()
    if let current {
      AudioQueueStop(current, true)
      AudioQueueDispose(current, true)
    }
    event(outcome)
    event("retired")
    exit(outcome == "failed" ? 1 : 0)
  }

  func stop() { finish("canceled") }

  private func bufferConsumed(_ queue: AudioQueueRef) {
    lock.lock()
    guard !terminal else { lock.unlock(); return }
    draining = true
    let shouldDrain = playing && !paused
    lock.unlock()
    if shouldDrain && AudioQueueStop(queue, false) != noErr { finish("failed") }
  }

  func receive(_ data: Data) -> Bool {
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["version"] as? Int == 1, json["sequence"] as? Int == sequence,
      let type = json["type"] as? String else { finish("failed"); return false }
    sequence += 1
    switch type {
    case "open":
      guard sequence == 1, json.count == 4, let uid = json["id"] as? String,
        let (devices, _) = outputs(), devices.contains(where: { $0.0 == uid }) else { finish("failed"); return false }
      var format = AudioStreamBasicDescription(mSampleRate: 24_000, mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
        mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
      var created: AudioQueueRef?
      let context = Unmanaged.passUnretained(self).toOpaque()
      guard AudioQueueNewOutput(&format, { context, queue, _ in
        guard let context else { return }
        let player = Unmanaged<Player>.fromOpaque(context).takeUnretainedValue()
        player.bufferConsumed(queue)
      }, context, nil, nil, 0, &created) == noErr, let created else { finish("failed"); return false }
      queue = created
      var device = uid as CFString
      guard AudioQueueSetProperty(created, kAudioQueueProperty_CurrentDevice, &device, UInt32(MemoryLayout<CFString>.size)) == noErr else { finish("failed"); return false }
      guard AudioQueueAddPropertyListener(created, kAudioQueueProperty_IsRunning, { context, queue, _ in
        guard let context else { return }
        let player = Unmanaged<Player>.fromOpaque(context).takeUnretainedValue()
        var running: UInt32 = 1
        var size = UInt32(MemoryLayout<UInt32>.size)
        if AudioQueueGetProperty(queue, kAudioQueueProperty_IsRunning, &running, &size) == noErr && running == 0 {
          player.lock.lock()
          let done = player.playing && player.draining && !player.paused && !player.terminal
          player.lock.unlock()
          if done { DispatchQueue.global().async { player.finish("ended") } }
        }
      }, context) == noErr else { finish("failed"); return false }
      event("ready")
    case "play":
      guard sequence == 2, json.count == 4, let encoded = json["wav"] as? String,
        encoded.utf8.count <= 2_598_460, let wav = Data(base64Encoded: encoded), wav.count >= 44, wav.count <= maxWav,
        String(data: wav.prefix(4), encoding: .ascii) == "RIFF", String(data: wav[8..<12], encoding: .ascii) == "WAVE",
        let queue else { finish("failed"); return false }
      let pcm = wav.dropFirst(44)
      guard !pcm.isEmpty else { finish("failed"); return false }
      var buffer: AudioQueueBufferRef?
      guard AudioQueueAllocateBuffer(queue, UInt32(pcm.count), &buffer) == noErr, let buffer else { finish("failed"); return false }
      pcm.withUnsafeBytes { bytes in if let base = bytes.baseAddress { buffer.pointee.mAudioData.copyMemory(from: base, byteCount: pcm.count) } }
      buffer.pointee.mAudioDataByteSize = UInt32(pcm.count)
      guard AudioQueueEnqueueBuffer(queue, buffer, 0, nil) == noErr, AudioQueueStart(queue, nil) == noErr else { finish("failed"); return false }
      event("started")
      lock.lock(); playing = true; let shouldDrain = draining && !paused; lock.unlock()
      if shouldDrain && AudioQueueStop(queue, false) != noErr { finish("failed"); return false }
    case "pause":
      guard json.count == 3, let queue else { finish("failed"); return false }
      lock.lock(); paused = true; lock.unlock()
      guard AudioQueuePause(queue) == noErr else { finish("failed"); return false }
      event("paused")
    case "resume":
      guard json.count == 3, let queue, AudioQueueStart(queue, nil) == noErr else { finish("failed"); return false }
      lock.lock(); paused = false; let shouldDrain = draining; lock.unlock()
      event("resumed")
      if shouldDrain && AudioQueueStop(queue, false) != noErr { finish("failed"); return false }
    case "stop":
      guard json.count == 3 else { finish("failed"); return false }
      stop()
    default:
      finish("failed")
      return false
    }
    return true
  }
}

if CommandLine.arguments == [CommandLine.arguments[0], "--list"] { list() }
if CommandLine.arguments == [CommandLine.arguments[0], "--play"] {
  let player = Player()
  lines { player.receive($0) }
  player.stop()
}
exit(1)
