//! Progress, speed and time remaining for a running transfer.
//!
//! Pure and clock-injected: every figure the panel shows is computed here, so
//! none of it needs a live connection to be tested.

use serde::Serialize;

/// Samples older than this stop counting, so a stall shows as slowing down
/// rather than as the average of a long-finished burst.
const WINDOW_MS: u64 = 5_000;
/// Enough to smooth a bursty link without letting the window grow unbounded.
const MAX_SAMPLES: usize = 64;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: u64,
    pub files_total: u64,
    /// Rounded to whole bytes per second; `None` until there are two samples.
    pub bytes_per_second: Option<u64>,
    /// `None` when the speed is unknown or nothing is left.
    pub seconds_remaining: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Sample {
    at_ms: u64,
    bytes_done: u64,
}

#[derive(Clone, Debug, Default)]
pub struct ProgressTracker {
    samples: Vec<Sample>,
    bytes_done: u64,
    bytes_total: u64,
    files_done: u64,
    files_total: u64,
}

impl ProgressTracker {
    pub fn new(bytes_total: u64, files_total: u64) -> Self {
        Self {
            samples: Vec::new(),
            bytes_done: 0,
            bytes_total,
            files_done: 0,
            files_total,
        }
    }

    /// Record cumulative bytes at a point in time. `at_ms` must not go
    /// backwards; a repeated timestamp is kept as the newest reading.
    pub fn observe(&mut self, at_ms: u64, bytes_done: u64) {
        self.bytes_done = bytes_done;
        self.samples.push(Sample { at_ms, bytes_done });
        self.samples
            .retain(|sample| at_ms.saturating_sub(sample.at_ms) <= WINDOW_MS);
        if self.samples.len() > MAX_SAMPLES {
            let excess = self.samples.len() - MAX_SAMPLES;
            self.samples.drain(0..excess);
        }
    }

    pub fn file_finished(&mut self) {
        self.files_done = self.files_done.saturating_add(1);
    }

    /// Bytes per second across the retained window, or `None` when a single
    /// sample makes any figure a guess.
    pub fn speed(&self) -> Option<u64> {
        let first = self.samples.first()?;
        let last = self.samples.last()?;
        let elapsed = last.at_ms.checked_sub(first.at_ms)?;
        if elapsed == 0 {
            return None;
        }
        let moved = last.bytes_done.saturating_sub(first.bytes_done);
        Some(moved.saturating_mul(1_000) / elapsed)
    }

    pub fn snapshot(&self) -> TransferProgress {
        let bytes_per_second = self.speed();
        let remaining = self.bytes_total.saturating_sub(self.bytes_done);
        let seconds_remaining = match bytes_per_second {
            Some(speed) if speed > 0 && remaining > 0 => Some(remaining.div_ceil(speed)),
            _ => None,
        };
        TransferProgress {
            bytes_done: self.bytes_done,
            bytes_total: self.bytes_total,
            files_done: self.files_done,
            files_total: self.files_total,
            bytes_per_second,
            seconds_remaining,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_tracker_reports_nothing_done_and_no_speed() {
        let snapshot = ProgressTracker::new(100, 2).snapshot();
        assert_eq!(snapshot.bytes_done, 0);
        assert_eq!(snapshot.bytes_total, 100);
        assert_eq!(snapshot.files_total, 2);
        assert_eq!(snapshot.bytes_per_second, None);
        assert_eq!(snapshot.seconds_remaining, None);
    }

    #[test]
    fn one_sample_is_not_enough_for_a_speed() {
        let mut tracker = ProgressTracker::new(100, 1);
        tracker.observe(0, 10);
        assert_eq!(tracker.snapshot().bytes_per_second, None);
        assert_eq!(tracker.snapshot().bytes_done, 10);
    }

    #[test]
    fn speed_is_bytes_moved_over_time_elapsed() {
        let mut tracker = ProgressTracker::new(1_000, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 250);
        assert_eq!(tracker.snapshot().bytes_per_second, Some(250));
    }

    #[test]
    fn time_remaining_follows_the_measured_speed() {
        let mut tracker = ProgressTracker::new(1_000, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 250);
        // 750 bytes left at 250 per second.
        assert_eq!(tracker.snapshot().seconds_remaining, Some(3));
    }

    #[test]
    fn time_remaining_rounds_up_so_it_never_shows_zero_while_work_is_left() {
        let mut tracker = ProgressTracker::new(1_100, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 1_000);
        assert_eq!(tracker.snapshot().seconds_remaining, Some(1));
    }

    #[test]
    fn a_finished_transfer_has_no_time_remaining() {
        let mut tracker = ProgressTracker::new(500, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 500);
        assert_eq!(tracker.snapshot().seconds_remaining, None);
    }

    #[test]
    fn a_stall_drags_the_speed_down_instead_of_reporting_the_old_burst() {
        let mut tracker = ProgressTracker::new(10_000, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 1_000);
        assert_eq!(tracker.snapshot().bytes_per_second, Some(1_000));

        // Four more seconds with nothing moving, still inside the window.
        tracker.observe(5_000, 1_000);
        assert_eq!(tracker.snapshot().bytes_per_second, Some(200));
    }

    #[test]
    fn samples_older_than_the_window_are_dropped() {
        let mut tracker = ProgressTracker::new(10_000, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 5_000);
        // Far past the window: only readings within it should remain.
        tracker.observe(20_000, 6_000);
        tracker.observe(21_000, 7_000);
        assert_eq!(tracker.snapshot().bytes_per_second, Some(1_000));
    }

    #[test]
    fn a_repeated_timestamp_does_not_divide_by_zero() {
        let mut tracker = ProgressTracker::new(100, 1);
        tracker.observe(1_000, 10);
        tracker.observe(1_000, 20);
        assert_eq!(tracker.snapshot().bytes_per_second, None);
        assert_eq!(tracker.snapshot().bytes_done, 20);
    }

    #[test]
    fn the_sample_window_stays_bounded_under_a_flood() {
        let mut tracker = ProgressTracker::new(u64::MAX, 1);
        for index in 0..(MAX_SAMPLES as u64 * 4) {
            tracker.observe(index, index);
        }
        assert!(tracker.samples.len() <= MAX_SAMPLES);
    }

    #[test]
    fn finished_files_are_counted() {
        let mut tracker = ProgressTracker::new(10, 3);
        tracker.file_finished();
        tracker.file_finished();
        let snapshot = tracker.snapshot();
        assert_eq!(snapshot.files_done, 2);
        assert_eq!(snapshot.files_total, 3);
    }

    #[test]
    fn transferring_more_than_expected_does_not_underflow_the_remainder() {
        let mut tracker = ProgressTracker::new(100, 1);
        tracker.observe(0, 0);
        tracker.observe(1_000, 250);
        let snapshot = tracker.snapshot();
        assert_eq!(snapshot.bytes_done, 250);
        assert_eq!(snapshot.seconds_remaining, None);
    }
}
