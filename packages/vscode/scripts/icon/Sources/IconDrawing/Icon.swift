// The extension's icon: two speech bubbles as characters, the human's in grey with round eyes and
// the agent's in orange with cursor eyes, as shapes in a 128x128 box, y down, like the SVG.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A rounded rectangle in the box.
public struct Box: Sendable {
  /// The left edge.
  public let x: CGFloat
  /// The top edge.
  public let y: CGFloat
  /// How wide.
  public let width: CGFloat
  /// How tall.
  public let height: CGFloat
  /// The corners' radius.
  public let cornerRadius: CGFloat
  /// The fill, as `#RRGGBB`.
  public let fill: String

  /// Makes a box from its edges, size, corners, and fill.
  public init(
    x: CGFloat,
    y: CGFloat,
    width: CGFloat,
    height: CGFloat,
    cornerRadius: CGFloat,
    fill: String
  ) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
    self.cornerRadius = cornerRadius
    self.fill = fill
  }
}

/// A filled triangle in the box, such as a bubble's tail.
public struct Triangle: Sendable {
  /// The three corners, in drawing order.
  public let corners: [CGPoint]
  /// The fill, as `#RRGGBB`.
  public let fill: String

  /// Makes a triangle from its three corners and fill.
  public init(_ first: CGPoint, _ second: CGPoint, _ third: CGPoint, fill: String) {
    self.corners = [first, second, third]
    self.fill = fill
  }
}

/// A stroked quadratic curve with round ends, such as a smile.
public struct Curve: Sendable {
  /// Where the curve starts.
  public let start: CGPoint
  /// The point the curve bends toward.
  public let control: CGPoint
  /// Where the curve ends.
  public let end: CGPoint
  /// The stroke's width.
  public let lineWidth: CGFloat
  /// The stroke, as `#RRGGBB`.
  public let stroke: String

  /// Makes a curve from its ends, its control point, and its stroke.
  public init(
    start: CGPoint,
    control: CGPoint,
    end: CGPoint,
    lineWidth: CGFloat,
    stroke: String
  ) {
    self.start = start
    self.control = control
    self.end = end
    self.lineWidth = lineWidth
    self.stroke = stroke
  }
}

/// One of the icon's shapes.
public enum Shape: Sendable {
  /// A rounded rectangle.
  case box(Box)
  /// A filled triangle.
  case triangle(Triangle)
  /// A stroked curve.
  case curve(Curve)
}

/// What can go wrong drawing or writing the icon.
public enum IconError: Error {
  /// A fill that is not `#RRGGBB`.
  case color(String)
  /// No bitmap of this size could be made.
  case bitmap(Int)
  /// The bitmap could not be rendered to an image.
  case render
  /// The file at this path could not be written.
  case write(String)
}

/// The icon as shipped: its box and its shapes, in the order they are drawn.
public enum Icon {
  /// The side of the square the shapes are placed in.
  public static let boxSize: CGFloat = 128
  /// The side of the PNG the extension ships.
  public static let pngSize = 256

  /// The dark of the tile, the faces, and the gap between the bubbles.
  static let dark = "#1F1F1F"
  /// The human's bubble.
  static let grey = "#CCCCCC"
  /// The agent's bubble, the color of its cursor in the editor.
  static let orange = "#E8875B"
  /// The width of a smile.
  static let smileWidth: CGFloat = 3.5

  /// The dark rounded square behind everything.
  public static let tile = Box(
    x: 0,
    y: 0,
    width: boxSize,
    height: boxSize,
    cornerRadius: 28,
    fill: dark
  )
  /// The human's bubble, its tail down and to the left, and its face: round eyes and a smile.
  public static let human: [Shape] = [
    .box(Box(x: 6, y: 22, width: 76, height: 50, cornerRadius: 12, fill: grey)),
    .triangle(
      Triangle(CGPoint(x: 24, y: 70), CGPoint(x: 40, y: 70), CGPoint(x: 24, y: 85), fill: grey)
    ),
    .box(Box(x: 19, y: 35, width: 10, height: 10, cornerRadius: 5, fill: dark)),
    .box(Box(x: 37, y: 35, width: 10, height: 10, cornerRadius: 5, fill: dark)),
    .curve(
      Curve(
        start: CGPoint(x: 26, y: 52),
        control: CGPoint(x: 33, y: 58),
        end: CGPoint(x: 40, y: 52),
        lineWidth: smileWidth,
        stroke: dark
      )
    ),
  ]
  /// The agent's bubble over the human's, edged in dark to part them, its tail down and to the
  /// right, and its face: text-cursor eyes and a smile.
  public static let agent: [Shape] = [
    .box(Box(x: 44, y: 48, width: 80, height: 54, cornerRadius: 14, fill: dark)),
    .box(Box(x: 48, y: 52, width: 72, height: 46, cornerRadius: 10, fill: orange)),
    .triangle(
      Triangle(CGPoint(x: 88, y: 96), CGPoint(x: 104, y: 96), CGPoint(x: 104, y: 112), fill: orange)
    ),
    .box(Box(x: 77, y: 63, width: 6, height: 16, cornerRadius: 1.5, fill: dark)),
    .box(Box(x: 97, y: 63, width: 6, height: 16, cornerRadius: 1.5, fill: dark)),
    .curve(
      Curve(
        start: CGPoint(x: 83, y: 87),
        control: CGPoint(x: 90, y: 93),
        end: CGPoint(x: 97, y: 87),
        lineWidth: smileWidth,
        stroke: dark
      )
    ),
  ]
  /// Every shape, in the order it is drawn.
  public static let shapes: [Shape] = [.box(tile)] + human + agent
}

let channelMax = 0xFF

/// Returns the color of a `#RRGGBB` string.
public func color(_ hex: String) throws -> CGColor {
  guard hex.hasPrefix("#"), hex.count == 7, let value = Int(hex.dropFirst(), radix: 16) else {
    throw IconError.color(hex)
  }
  return CGColor(
    srgbRed: CGFloat((value >> 16) & channelMax) / CGFloat(channelMax),
    green: CGFloat((value >> 8) & channelMax) / CGFloat(channelMax),
    blue: CGFloat(value & channelMax) / CGFloat(channelMax),
    alpha: 1
  )
}

/// Draws a shape into the context, in the box's coordinates.
func draw(_ shape: Shape, in context: CGContext) throws {
  switch shape {
  case .box(let box):
    let rect = CGRect(x: box.x, y: box.y, width: box.width, height: box.height)
    let radius = box.cornerRadius
    context.addPath(
      CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    )
    context.setFillColor(try color(box.fill))
    context.fillPath()
  case .triangle(let triangle):
    context.addLines(between: triangle.corners)
    context.closePath()
    context.setFillColor(try color(triangle.fill))
    context.fillPath()
  case .curve(let curve):
    context.move(to: curve.start)
    context.addQuadCurve(to: curve.end, control: curve.control)
    context.setLineWidth(curve.lineWidth)
    context.setLineCap(.round)
    context.setStrokeColor(try color(curve.stroke))
    context.strokePath()
  }
}

/// Returns a number as SVG writes it: at most two decimals, no trailing zeros.
public func svgNumber(_ value: CGFloat) -> String {
  String(format: "%g", (value * 100).rounded() / 100)
}

/// Returns a point as SVG writes it, separated by `separator`.
func svgPoint(_ point: CGPoint, separator: String) -> String {
  "\(svgNumber(point.x))\(separator)\(svgNumber(point.y))"
}

/// Returns an SVG attribute, `name="value"`.
func attribute(_ name: String, _ value: String) -> String {
  #"\#(name)="\#(value)""#
}

/// Returns the shape as an SVG element: a `rect`, a `polygon`, or a `path`.
public func svg(_ shape: Shape) -> String {
  let attributes: [String]
  let element: String
  switch shape {
  case .box(let box):
    element = "rect"
    attributes = [
      attribute("x", svgNumber(box.x)),
      attribute("y", svgNumber(box.y)),
      attribute("width", svgNumber(box.width)),
      attribute("height", svgNumber(box.height)),
      attribute("rx", svgNumber(box.cornerRadius)),
      attribute("fill", box.fill),
    ]
  case .triangle(let triangle):
    element = "polygon"
    let points = triangle.corners.map { svgPoint($0, separator: ",") }
    attributes = [
      attribute("points", points.joined(separator: " ")),
      attribute("fill", triangle.fill),
    ]
  case .curve(let curve):
    element = "path"
    let start = svgPoint(curve.start, separator: " ")
    let control = svgPoint(curve.control, separator: " ")
    let end = svgPoint(curve.end, separator: " ")
    attributes = [
      attribute("d", "M\(start) Q\(control) \(end)"),
      attribute("fill", "none"),
      attribute("stroke", curve.stroke),
      attribute("stroke-width", svgNumber(curve.lineWidth)),
      attribute("stroke-linecap", "round"),
    ]
  }
  return "  <\(element) \(attributes.joined(separator: " "))/>"
}

/// Returns the whole icon as an SVG document.
public func svgDocument() -> String {
  let viewBox = "0 0 \(svgNumber(Icon.boxSize)) \(svgNumber(Icon.boxSize))"
  let svgOpen = #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="\#(viewBox)">"#
  return ([svgOpen] + Icon.shapes.map(svg) + ["</svg>", ""]).joined(separator: "\n")
}

/// Returns the icon rendered as a `size` by `size` bitmap.
public func render(size: Int) throws -> CGImage {
  guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB) else { throw IconError.render }
  guard
    let context = CGContext(
      data: nil,
      width: size,
      height: size,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: sRGB,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    throw IconError.bitmap(size)
  }
  let scale = CGFloat(size) / Icon.boxSize
  context.translateBy(x: 0, y: CGFloat(size))
  context.scaleBy(x: scale, y: -scale)
  for shape in Icon.shapes {
    try draw(shape, in: context)
  }
  guard let image = context.makeImage() else { throw IconError.render }
  return image
}

/// Writes the icon as a PNG at `path`.
public func writePNG(to path: String, size: Int) throws {
  let image = try render(size: size)
  let url = URL(fileURLWithPath: path) as CFURL
  let type = UTType.png.identifier as CFString
  guard let destination = CGImageDestinationCreateWithURL(url, type, 1, nil) else {
    throw IconError.write(path)
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { throw IconError.write(path) }
}

/// Writes the icon as an SVG at `path`.
public func writeSVG(to path: String) throws {
  try svgDocument().write(toFile: path, atomically: true, encoding: .utf8)
}
