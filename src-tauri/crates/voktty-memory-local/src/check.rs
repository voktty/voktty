use super::*;
use std::time::{SystemTime, UNIX_EPOCH};
use voktty_workspace_kit::{check_memory_preservation, MemoryCheckReport};

impl LocalMemoryWorkspace<'_> {
    /// Checks a native shared baseline against a fresh observation, without writing or approving compaction.
    pub fn check_preservation(
        &self,
        baseline: &NativeMemoryPreservation,
        control: &crate::DiscoveryControl,
    ) -> Result<MemoryCheckReport, ReadError> {
        let phase = control.read_control()?;
        let _permit = ReadPermit::acquire(&phase)?;
        self.check_binding(baseline, &phase)?;
        let previous_protected = baseline.protected.as_ref().ok_or(ReadError::InvalidInput)?;
        let current = self.capture_preservation_inner(control, true)?;
        let current_protected = current.protected.as_ref().ok_or(ReadError::InvalidInput)?;
        let config = parse_kit_config(&current.config).map_err(ReadError::Contract)?;
        let after_days = config["archive"]["afterDays"]
            .as_f64()
            .filter(|days| {
                days.is_finite() && days.fract() == 0.0 && (1.0..=36500.0).contains(days)
            })
            .ok_or(ReadError::InvalidInput)? as u64;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
            .filter(|now| *now <= 8640000000000000)
            .ok_or(ReadError::InvalidInput)?;
        let phase = control.read_control()?;
        let report = check_memory_preservation(
            &baseline.sources,
            &current.sources,
            previous_protected,
            current_protected,
            now_ms,
            after_days,
        )
        .map_err(ReadError::Contract)?;
        self.check_binding(baseline, &phase)?;
        self.check_binding(&current, &phase)?;
        phase.check()?;
        Ok(report)
    }
}
