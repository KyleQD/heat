import Foundation

/// Batches analytics events and flushes them to POST /v1/analytics/batch.
/// Fire-and-forget: analytics failures never affect UX (loading strategy §14).
public final class AnalyticsBatcher: @unchecked Sendable {

    private var queue: [AnalyticsEvent] = []
    private let lock = NSLock()
    private let send: @Sendable ([AnalyticsEvent]) async -> Void
    private let maxBatch: Int
    private let clock: @Sendable () -> Date
    private var lastFlush: Date
    private let minFlushInterval: TimeInterval
    private var flushTask: Task<Void, Never>?

    public init(send: @escaping @Sendable ([AnalyticsEvent]) async -> Void,
                maxBatch: Int = 40,
                minFlushInterval: TimeInterval = 8,
                clock: @escaping @Sendable () -> Date = { Date() }) {
        self.send = send
        self.maxBatch = maxBatch
        self.minFlushInterval = minFlushInterval
        self.clock = clock
        self.lastFlush = clock()
    }

    deinit { flushTask?.cancel() }

    public func enqueue(_ event: AnalyticsEvent) {
        lock.lock()
        queue.append(event)
        let size = queue.count
        let dueForFlush = clock().timeIntervalSince(lastFlush) >= minFlushInterval
        lock.unlock()

        if size >= maxBatch || dueForFlush {
            scheduleFlush()
        }
    }

    /// Coalesces concurrent triggers into a single detached flush.
    private func scheduleFlush() {
        lock.lock()
        if flushTask != nil { lock.unlock(); return }
        let task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            await self?.flush()
        }
        flushTask = task
        lock.unlock()
    }

    @discardableResult
    public func flush() async -> Int {
        let batch = takeBatch()
        guard !batch.isEmpty else { return 0 }
        await send(batch)
        return batch.count
    }

    /// Synchronous batch extraction — no locking across await boundaries.
    private func takeBatch() -> [AnalyticsEvent] {
        lock.lock()
        defer { lock.unlock() }
        flushTask = nil
        lastFlush = clock()
        let batch = queue
        queue.removeAll()
        return batch
    }

    public var pendingCount: Int {
        lock.lock(); defer { lock.unlock() }
        return queue.count
    }
}
