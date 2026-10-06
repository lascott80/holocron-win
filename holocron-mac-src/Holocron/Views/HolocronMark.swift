import SwiftUI

/// The Holocron cube logo: a hexagon outline with three inner edges.
struct HolocronMark: View {
    var color: Color = Theme.accent
    var lineWidth: CGFloat = 1.5
    var glowing = false

    var body: some View {
        ZStack {
            if glowing {
                CubeOutline().fill(color.opacity(0.22))
            }
            CubeOutline().stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineJoin: .round))
            CubeEdges().stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            if glowing {
                Circle().fill(.white).frame(width: lineWidth * 3, height: lineWidth * 3)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .shadow(color: glowing ? color.opacity(0.55) : .clear, radius: 12)
        .accessibilityHidden(true)
    }
}

nonisolated private struct CubeOutline: Shape {
    func path(in rect: CGRect) -> Path {
        let p = CubePoints(rect)
        var path = Path()
        path.move(to: p.top)
        path.addLine(to: p.upperRight)
        path.addLine(to: p.lowerRight)
        path.addLine(to: p.bottom)
        path.addLine(to: p.lowerLeft)
        path.addLine(to: p.upperLeft)
        path.closeSubpath()
        return path
    }
}

nonisolated private struct CubeEdges: Shape {
    func path(in rect: CGRect) -> Path {
        let p = CubePoints(rect)
        var path = Path()
        path.move(to: p.center); path.addLine(to: p.upperRight)
        path.move(to: p.center); path.addLine(to: p.bottom)
        path.move(to: p.center); path.addLine(to: p.upperLeft)
        return path
    }
}

/// Corner points of an isometric cube inscribed in `rect` (24-unit grid).
nonisolated private struct CubePoints {
    let top, upperRight, lowerRight, bottom, lowerLeft, upperLeft, center: CGPoint

    init(_ rect: CGRect) {
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * x / 24, y: rect.minY + rect.height * y / 24)
        }
        top = point(12, 2)
        upperRight = point(21, 7)
        lowerRight = point(21, 17)
        bottom = point(12, 22)
        lowerLeft = point(3, 17)
        upperLeft = point(3, 7)
        center = point(12, 12)
    }
}

#Preview {
    HolocronMark(glowing: true)
        .frame(width: 96, height: 96)
        .padding(40)
        .background(Theme.panelBackground)
}
