#!/usr/bin/env swift
// Draws Holocron's app icon (the glowing cube from the design canvas) and
// writes every size macOS needs into the asset catalog.
//
//   swift scripts/make-icon.swift
//
// Follows Apple's macOS icon grid: an 824×824 rounded square centred on a
// 1024×1024 canvas, leaving room for the drop shadow.
import AppKit

let canvas: CGFloat = 1024
let accent = NSColor(srgbRed: 0x5A / 255, green: 0xB4 / 255, blue: 0xFF / 255, alpha: 1)

func drawIcon(in context: CGContext) {
    let body = CGRect(x: 100, y: 100, width: 824, height: 824)
    let corner: CGFloat = 185

    // Drop shadow + body
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: NSColor.black.withAlphaComponent(0.45).cgColor)
    let bodyPath = CGPath(roundedRect: body, cornerWidth: corner, cornerHeight: corner, transform: nil)
    context.addPath(bodyPath)
    context.setFillColor(NSColor(srgbRed: 0.05, green: 0.06, blue: 0.08, alpha: 1).cgColor)
    context.fillPath()
    context.restoreGState()

    // Background gradient and a soft accent glow behind the cube
    context.saveGState()
    context.addPath(bodyPath)
    context.clip()
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let background = CGGradient(colorsSpace: space, colors: [
        NSColor(srgbRed: 0.11, green: 0.13, blue: 0.18, alpha: 1).cgColor,
        NSColor(srgbRed: 0.04, green: 0.05, blue: 0.07, alpha: 1).cgColor,
    ] as CFArray, locations: [0, 1])!
    context.drawLinearGradient(background, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
    let glow = CGGradient(colorsSpace: space, colors: [
        accent.withAlphaComponent(0.32).cgColor,
        accent.withAlphaComponent(0).cgColor,
    ] as CFArray, locations: [0, 1])!
    context.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 512), startRadius: 0, endCenter: CGPoint(x: 512, y: 512), endRadius: 400, options: [])
    // Hairline inner edge
    context.addPath(CGPath(roundedRect: body.insetBy(dx: 1.5, dy: 1.5), cornerWidth: corner - 1.5, cornerHeight: corner - 1.5, transform: nil))
    context.setStrokeColor(NSColor.white.withAlphaComponent(0.08).cgColor)
    context.setLineWidth(3)
    context.strokePath()
    context.restoreGState()

    // The cube: points on a 120-unit grid (matching the canvas SVG), scaled.
    let scale: CGFloat = 4.4
    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        // SVG y grows downward; flip for Core Graphics.
        CGPoint(x: 512 + (x - 60) * scale, y: 512 - (y - 60) * scale)
    }
    let top = point(60, 14), upperRight = point(100, 37), lowerRight = point(100, 83)
    let bottom = point(60, 106), lowerLeft = point(20, 83), upperLeft = point(20, 37), center = point(60, 60)

    func face(_ points: [CGPoint], alpha: CGFloat) {
        context.beginPath()
        context.addLines(between: points)
        context.closePath()
        context.setFillColor(accent.withAlphaComponent(alpha).cgColor)
        context.fillPath()
    }
    face([top, upperRight, center, upperLeft], alpha: 0.42)
    face([center, upperRight, lowerRight, bottom], alpha: 0.22)
    face([center, bottom, lowerLeft, upperLeft], alpha: 0.10)

    context.saveGState()
    context.setShadow(offset: .zero, blur: 36, color: accent.withAlphaComponent(0.9).cgColor)
    context.setStrokeColor(accent.cgColor)
    context.setLineWidth(14)
    context.setLineJoin(.round)
    context.setLineCap(.round)
    context.beginPath()
    context.addLines(between: [top, upperRight, lowerRight, bottom, lowerLeft, upperLeft])
    context.closePath()
    context.move(to: center); context.addLine(to: upperRight)
    context.move(to: center); context.addLine(to: bottom)
    context.move(to: center); context.addLine(to: upperLeft)
    context.strokePath()
    context.restoreGState()

    // Glowing core
    context.saveGState()
    context.setShadow(offset: .zero, blur: 40, color: NSColor.white.cgColor)
    context.setFillColor(NSColor.white.cgColor)
    context.fillEllipse(in: CGRect(x: center.x - 24, y: center.y - 24, width: 48, height: 48))
    context.restoreGState()
}

func render(size: Int) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    )!
    let graphics = NSGraphicsContext(bitmapImageRep: rep)!
    graphics.imageInterpolation = .high
    let context = graphics.cgContext
    context.scaleBy(x: CGFloat(size) / canvas, y: CGFloat(size) / canvas)
    drawIcon(in: context)
    return rep.representation(using: .png, properties: [:])!
}

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "Holocron/Assets.xcassets/AppIcon.appiconset")

var images: [[String: String]] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        try! render(size: points * scale).write(to: output.appendingPathComponent(name))
        images.append(["idiom": "mac", "scale": "\(scale)x", "size": "\(points)x\(points)", "filename": name])
    }
}
let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
let json = try! JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
try! json.write(to: output.appendingPathComponent("Contents.json"))
print("Wrote \(images.count) icon images to \(output.path)")
