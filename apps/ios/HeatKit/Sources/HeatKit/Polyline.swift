import Foundation

/// Google-encoded polyline decoder (P6-006 route layer geometry).
/// Round-trips with the server's encoder; pure Swift so it is unit-tested
/// without MapKit.
public enum PolylineDecoder {

    public static func decode(_ encoded: String) -> [Coordinate] {
        var coordinates: [Coordinate] = []
        var index = encoded.startIndex
        var lat: Int32 = 0
        var lng: Int32 = 0

        while index < encoded.endIndex {
            guard let dLat = decodeValue(encoded, from: &index) else { break }
            guard let dLng = decodeValue(encoded, from: &index) else { break }
            lat += dLat
            lng += dLng
            coordinates.append(Coordinate(lat: Double(lat) / 1e5, lng: Double(lng) / 1e5))
        }
        return coordinates
    }

    /// Varint delta chunk: continuation bit 0x20, zig-zag decode via ~(v >> 1).
    private static func decodeValue(_ s: String, from index: inout String.Index) -> Int32? {
        var result: UInt32 = 0
        var shift: UInt32 = 0
        while index < s.endIndex {
            let scalar = s[index]
            index = s.index(after: index)
            guard var byte = scalar.asciiValue else { return nil }
            byte -= 63 // spec: chars are payload+cont, offset by '?'
            if byte > 0x3F { return nil } // invalid symbol guard
            let payload = UInt32(byte & 0x1F)
            result |= payload << shift
            if byte & 0x20 == 0 {
                // Zig-zag: negative values come back as ~v>>1.
                return Int32(result >> 1) ^ -Int32(result & 1)
            }
            shift += 5
            if shift > 30 { return nil } // malformed guard
        }
        return nil
    }

    /// Encoder used by the estimate provider; kept here for round-trip tests.
    public static func encode(_ points: [Coordinate]) -> String {
        var out = ""
        var prevLat = 0
        var prevLng = 0
        for p in points {
            let iLat = Int((p.lat * 1e5).rounded())
            let iLng = Int((p.lng * 1e5).rounded())
            out += encodeVar(iLat - prevLat)
            out += encodeVar(iLng - prevLng)
            prevLat = iLat
            prevLng = iLng
        }
        return out
    }

    private static func encodeVar(_ v0: Int) -> String {
        var v = v0 < 0 ? ~(v0 << 1) : (v0 << 1)
        var chunk = ""
        while v >= 0x20 {
            chunk.append(Character(UnicodeScalar(UInt8(0x20 | (v & 0x1F)) + 63)))
            v >>= 5
        }
        chunk.append(Character(UnicodeScalar(UInt8(v + 63))))
        return chunk
    }
}

// MARK: - Deep links (doc 25 §10): heat://event/:id

public enum DeepLink: Equatable {

    case event(UUID)

    public static func parse(_ url: URL) -> DeepLink? {
        // Support both heat://event/<id> and https://heat.app/event/<id>
        let path: [String]
        if url.scheme == "heat" {
            // Custom scheme: heat://event/<id> places "event" in host position.
            path = ([url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" })
        } else if url.host == "heat.app" || url.host == "www.heat.app" {
            path = url.pathComponents.filter { $0 != "/" }
        } else {
            return nil
        }
        guard path.count == 2, path[0] == "event", let id = UUID(uuidString: path[1]) else {
            return nil
        }
        return .event(id)
    }
}
