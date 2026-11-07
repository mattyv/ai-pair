import AudioToolbox
import CoreAudio
import Darwin
import Foundation

// Wire protocol v1: one process owns one exact output, never a fallback route.
private let maxLine = 2_600_000
private let maxWav = 1_948_844
private let maxDevices = 64

private func validWav(_ data: Data) -> Bool {
  guard data.count >= 46, data.count <= maxWav else { return false }
  func word(_ offset: Int, _ count: Int) -> UInt32 {
    var value: UInt32 = 0
    for index in 0..<count { value |= UInt32(data[offset + index]) << (8 * index) }
    return value
  }
  return data.prefix(4) == Data("RIFF".utf8) && data[8..<16] == Data("WAVEfmt ".utf8)
    && data[36..<40] == Data("data".utf8) && word(4, 4) == UInt32(data.count - 8)
    && word(16, 4) == 16 && word(20, 2) == 1 && word(22, 2) == 1
    && word(24, 4) == 24_000 && word(28, 4) == 48_000 && word(32, 2) == 2
    && word(34, 2) == 16 && word(40, 4) == UInt32(data.count - 44)
    && (data.count - 44) % 2 == 0
}
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

private func outputs() -> ([(String, String, AudioDeviceID)], String?)? {
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
  var devices: [(String, String, AudioDeviceID)] = []
  var defaultID: String?
  for device in ids {
    var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
    var streamSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &streams, 0, nil, &streamSize) == noErr, streamSize > 0,
      let uid = propertyString(device, kAudioDevicePropertyDeviceUID), !uid.isEmpty, uid.utf8.count <= 512,
      let label = propertyString(device, kAudioObjectPropertyName), label.utf8.count <= 256 else { continue }
    if gotDefault && device == defaultDevice { defaultID = uid }
    if devices.count < maxDevices { devices.append((uid, label, device)) }
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
private func lines(_ receive: (Data) -> Bool) -> Bool {
  var pending = Data()
  while true {
    let chunk = try? FileHandle.standardInput.read(upToCount: 4096)
    guard let chunk, !chunk.isEmpty else { return pending.isEmpty }
    for byte in chunk {
      if byte == 10 {
        if !receive(pending) { return false }
        pending.removeAll(keepingCapacity: true)
      } else {
        if pending.count >= maxLine { return false }
        pending.append(byte)
      }
    }
  }
}

private final class Player {
  private var queue: AudioQueueRef?
  private var selectedUID: String?
  private var sequence = 0
  private var playing = false
  private var paused = false
  private var draining = false
  private var terminal = false
  private let control = DispatchQueue(label: "ai.pair.audio.control")

  private func finish(_ outcome: String) {
    guard !terminal else { return }
    terminal = true
    let current = queue
    queue = nil
    if let current {
      _ = AudioQueueStop(current, true)
      guard AudioQueueDispose(current, true) == noErr else {
        event("failed")
        exit(1)
      }
    }
    event(outcome)
    event("retired")
    exit(outcome == "failed" ? 1 : 0)
  }

  func stop() { control.sync { finish("canceled") } }
  func fail() { control.sync { finish("failed") } }

  func receive(_ data: Data) -> Bool { control.sync { handle(data) } }

  private func bufferConsumed(_ callbackQueue: AudioQueueRef) {
    control.async {
      guard !self.terminal, self.queue == callbackQueue else { return }
      self.draining = true
      if self.playing && !self.paused && AudioQueueStop(callbackQueue, false) != noErr { self.finish("failed") }
    }
  }

  private func handle(_ data: Data) -> Bool {
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = json["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.intValue == 1, version.doubleValue == 1,
      let ordinal = json["sequence"] as? NSNumber, CFGetTypeID(ordinal) != CFBooleanGetTypeID(),
      ordinal.doubleValue == Double(sequence), ordinal.intValue == sequence,
      let type = json["type"] as? String else { finish("failed"); return false }
    sequence += 1
    switch type {
    case "open":
      guard sequence == 1, json.count == 4, let uid = json["id"] as? String,
        let (devices, _) = outputs(), let selected = devices.first(where: { $0.0 == uid }) else { finish("failed"); return false }
      selectedUID = uid
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
      var aliveAddress = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsAlive, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
      guard AudioObjectAddPropertyListener(selected.2, &aliveAddress, { device, _, _, context in
        guard let context else { return noErr }
        let player = Unmanaged<Player>.fromOpaque(context).takeUnretainedValue()
        player.control.async {
          guard !player.terminal else { return }
          var alive: UInt32 = 0
          var size = UInt32(MemoryLayout<UInt32>.size)
          var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsAlive, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
          let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &alive)
          if status != noErr || alive == 0 { player.finish("failed") }
        }
        return noErr
      }, context) == noErr else { finish("failed"); return false }
      guard AudioQueueAddPropertyListener(created, kAudioQueueProperty_CurrentDevice, { context, queue, _ in
        guard let context else { return }
        let player = Unmanaged<Player>.fromOpaque(context).takeUnretainedValue()
        player.control.async {
          guard !player.terminal, player.queue == queue else { return }
          var uid: CFString = "" as CFString
          var size = UInt32(MemoryLayout<CFString>.size)
          let status = AudioQueueGetProperty(queue, kAudioQueueProperty_CurrentDevice, &uid, &size)
          if status != noErr || (uid as String) != player.selectedUID { player.finish("failed") }
        }
      }, context) == noErr else { finish("failed"); return false }
      guard AudioQueueAddPropertyListener(created, kAudioQueueProperty_IsRunning, { context, queue, _ in
        guard let context else { return }
        let player = Unmanaged<Player>.fromOpaque(context).takeUnretainedValue()
        player.control.async {
          guard !player.terminal, player.queue == queue else { return }
          var running: UInt32 = 1
          var size = UInt32(MemoryLayout<UInt32>.size)
          let status = AudioQueueGetProperty(queue, kAudioQueueProperty_IsRunning, &running, &size)
          if status != noErr { player.finish("failed"); return }
          if running == 0 && player.playing && player.draining && !player.paused { player.finish("ended") }
        }
      }, context) == noErr else { finish("failed"); return false }
      event("ready")
    case "play":
      guard sequence == 2, json.count == 4, let encoded = json["wav"] as? String,
        encoded.utf8.count <= 2_598_460, let wav = Data(base64Encoded: encoded), validWav(wav),
        let queue else { finish("failed"); return false }
      let pcm = wav.dropFirst(44)
      guard !pcm.isEmpty else { finish("failed"); return false }
      var buffer: AudioQueueBufferRef?
      guard AudioQueueAllocateBuffer(queue, UInt32(pcm.count), &buffer) == noErr, let buffer else { finish("failed"); return false }
      pcm.withUnsafeBytes { bytes in if let base = bytes.baseAddress { buffer.pointee.mAudioData.copyMemory(from: base, byteCount: pcm.count) } }
      buffer.pointee.mAudioDataByteSize = UInt32(pcm.count)
      guard AudioQueueEnqueueBuffer(queue, buffer, 0, nil) == noErr, AudioQueueStart(queue, nil) == noErr else { finish("failed"); return false }
      event("started")
      playing = true
      let shouldDrain = draining && !paused
      if shouldDrain && AudioQueueStop(queue, false) != noErr { finish("failed"); return false }
    case "pause":
      guard json.count == 3, let queue else { finish("failed"); return false }
      let validPause = playing && !paused && !terminal
      if validPause { paused = true }
      guard validPause, AudioQueuePause(queue) == noErr else { finish("failed"); return false }
      event("paused")
    case "resume":
      guard json.count == 3, let queue else { finish("failed"); return false }
      let validResume = playing && paused && !terminal
      guard validResume, AudioQueueStart(queue, nil) == noErr else { finish("failed"); return false }
      paused = false
      let shouldDrain = draining
      event("resumed")
      if shouldDrain && AudioQueueStop(queue, false) != noErr { finish("failed"); return false }
    case "stop":
      guard json.count == 3 else { finish("failed"); return false }
      finish("canceled")
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
  if lines({ player.receive($0) }) { player.stop() } else { player.fail() }
}
exit(1)
