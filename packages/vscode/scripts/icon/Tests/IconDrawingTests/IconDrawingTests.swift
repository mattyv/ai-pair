// The icon's drawing, and that what the package writes is what media/ holds.

import CoreGraphics
import Foundation
import IconDrawing
import XCTest

/// The extension's folder, which holds media/, from the package's.
let extensionDirectory = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()  // the file
  .deletingLastPathComponent()  // IconDrawingTests
  .deletingLastPathComponent()  // Tests
  .deletingLastPathComponent()  // icon
  .deletingLastPathComponent()  // scripts

/// The bytes of one pixel: red, green, blue, and alpha.
let bytesPerPixel = 4

/// Returns the red, green, and blue of the pixel at `x`, `y` in the image, top left first.
func rgb(of image: CGImage, x: Int, y: Int) throws -> [Int] {
  let data = try XCTUnwrap(image.dataProvider?.data) as Data
  let start = y * image.bytesPerRow + x * bytesPerPixel
  return data[start..<start + 3].map { Int($0) }
}

final class ColorTests: XCTestCase {
  func testParsesEachChannel() throws {
    let components = try XCTUnwrap(try color("#FF8000").components)
    XCTAssertEqual(components[0], 1, accuracy: 0.001)
    XCTAssertEqual(components[1], 128.0 / 255.0, accuracy: 0.001)
    XCTAssertEqual(components[2], 0, accuracy: 0.001)
    XCTAssertEqual(components[3], 1)
  }

  func testRejectsWhatIsNotRRGGBB() {
    XCTAssertThrowsError(try color("FF8000"))
    XCTAssertThrowsError(try color("#FF80"))
    XCTAssertThrowsError(try color("#GGGGGG"))
  }
}

final class SVGTests: XCTestCase {
  func testNumbersHaveAtMostTwoDecimalsAndNoTrailingZeros() {
    XCTAssertEqual(svgNumber(42.5), "42.5")
    XCTAssertEqual(svgNumber(28), "28")
    XCTAssertEqual(svgNumber(1.0 / 3.0), "0.33")
  }

  func testBoxIsARect() {
    let box = Box(x: 1, y: 2, width: 3, height: 4, cornerRadius: 5, fill: "#ABCDEF")
    XCTAssertEqual(
      svg(.box(box)),
      ##"  <rect x="1" y="2" width="3" height="4" rx="5" fill="#ABCDEF"/>"##
    )
  }

  func testTriangleIsAPolygonOfItsCorners() {
    let triangle = Triangle(
      CGPoint(x: 1, y: 2),
      CGPoint(x: 3.5, y: 4),
      CGPoint(x: 5, y: 6),
      fill: "#ABCDEF"
    )
    XCTAssertEqual(
      svg(.triangle(triangle)),
      ##"  <polygon points="1,2 3.5,4 5,6" fill="#ABCDEF"/>"##
    )
  }

  func testCurveIsAStrokedQuadraticPathWithRoundEnds() {
    let curve = Curve(
      start: CGPoint(x: 1, y: 2),
      control: CGPoint(x: 3, y: 4),
      end: CGPoint(x: 5, y: 6),
      lineWidth: 1.5,
      stroke: "#ABCDEF"
    )
    XCTAssertEqual(
      svg(.curve(curve)),
      ##"  <path d="M1 2 Q3 4 5 6" fill="none" stroke="#ABCDEF" stroke-width="1.5" stroke-linecap="round"/>"##
    )
  }
}

final class ShippedIconTests: XCTestCase {
  func testSVGIsTheOneShipped() throws {
    let shipped = try String(
      contentsOf: extensionDirectory.appendingPathComponent("media/icon.svg"),
      encoding: .utf8
    )
    XCTAssertEqual(
      svgDocument(),
      shipped,
      "media/icon.svg is stale: swift run --package-path scripts/icon icon"
    )
  }

  func testPNGRendersAtTheShippedSize() throws {
    let image = try render(size: Icon.pngSize)
    XCTAssertEqual(image.width, Icon.pngSize)
    XCTAssertEqual(image.height, Icon.pngSize)
  }

  func testDrawsEachPartInItsColor() throws {
    // At the box's own size, one pixel is one unit of the box, y down.
    let image = try render(size: Int(Icon.boxSize))
    let dark = [0x1F, 0x1F, 0x1F]
    let grey = [0xCC, 0xCC, 0xCC]
    let orange = [0xE8, 0x87, 0x5B]
    let parts: [(name: String, x: Int, y: Int, expected: [Int])] = [
      ("the tile", 64, 10, dark),
      ("the human's bubble", 30, 28, grey),
      ("the human's tail", 26, 80, grey),
      ("the human's eye", 24, 40, dark),
      ("the human's smile", 33, 55, dark),
      ("the agent's bubble", 60, 90, orange),
      ("the agent's tail", 102, 108, orange),
      ("the agent's eye", 80, 70, dark),
      ("the agent's smile", 90, 90, dark),
      ("the edge between the bubbles", 46, 60, dark),
    ]
    // Each part reads "<name>: true" when every channel is within 2 of its color.
    let drawn = try parts.map { part in
      let actual = try rgb(of: image, x: part.x, y: part.y)
      let off = zip(actual, part.expected).reduce(0) { max($0, abs($1.0 - $1.1)) }
      return "\(part.name): \(off <= 2)"
    }
    XCTAssertEqual(drawn, parts.map { "\($0.name): true" })
  }

  func testRenderingAtNoSizeFails() {
    XCTAssertThrowsError(try render(size: 0))
  }

  func testWritesBothFiles() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock {
      try FileManager.default.removeItem(at: directory)
    }
    let png = directory.appendingPathComponent("icon.png").path
    let svg = directory.appendingPathComponent("icon.svg").path
    try writePNG(to: png, size: 64)
    try writeSVG(to: svg)
    XCTAssertTrue(FileManager.default.fileExists(atPath: png))
    XCTAssertEqual(try String(contentsOfFile: svg, encoding: .utf8), svgDocument())
  }

  func testWritingWhereItCannotFails() {
    XCTAssertThrowsError(try writePNG(to: "/nonexistent/folder/icon.png", size: 8))
  }
}
