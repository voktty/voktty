use super::diff::{diff_contents, split_lines, DiffHunk};
use super::models::{LineRange, Reconciliation, ReviewClaim, ReviewRange, ReviewSource};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Interval {
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributedInterval {
    pub start: usize,
    pub end: usize,
    pub source: ReviewSource,
    pub viewed_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub old_start: usize,
    pub old_end: usize,
    pub head_start: usize,
    pub head_end: usize,
}

pub fn unchanged_segments(hunks: &[DiffHunk]) -> Vec<Segment> {
    let mut sorted = hunks.to_vec();
    sorted.sort_by_key(|h| h.old_start);

    let mut segments = Vec::new();
    let mut old_cursor = 1usize;
    let mut head_cursor = 1usize;

    for hunk in sorted {
        let old_touched_start = if hunk.old_lines > 0 {
            hunk.old_start
        } else {
            hunk.old_start + 1
        };
        let old_touched_end = if hunk.old_lines > 0 {
            hunk.old_start + hunk.old_lines - 1
        } else {
            hunk.old_start
        };
        let head_touched_end = if hunk.new_lines > 0 {
            hunk.new_start + hunk.new_lines - 1
        } else {
            hunk.new_start
        };

        if old_touched_start > old_cursor {
            let gap_length = old_touched_start - 1 - old_cursor;
            segments.push(Segment {
                old_start: old_cursor,
                old_end: old_touched_start - 1,
                head_start: head_cursor,
                head_end: head_cursor + gap_length,
            });
        }
        old_cursor = old_touched_end + 1;
        head_cursor = head_touched_end + 1;
    }

    segments.push(Segment {
        old_start: old_cursor,
        old_end: usize::MAX,
        head_start: head_cursor,
        head_end: usize::MAX,
    });

    segments
}

pub fn project_ranges(ranges: &[LineRange], segments: &[Segment]) -> Vec<Interval> {
    let mut result = Vec::new();
    for range in ranges {
        for seg in segments {
            let start = range.start_line.max(seg.old_start);
            let end = range.end_line.min(seg.old_end);
            if start > end {
                continue;
            }
            let shift = seg.head_start as isize - seg.old_start as isize;
            let proj_start = (start as isize + shift) as usize;
            let proj_end = (end as isize + shift) as usize;
            result.push(Interval {
                start: proj_start,
                end: proj_end,
            });
        }
    }
    result
}

pub fn project_claim_coverage(claim: &ReviewClaim, head_content: &str) -> Vec<AttributedInterval> {
    let snapshot_lines_count = split_lines(&claim.snapshot_content).len().max(1);
    let whole_file_range = vec![LineRange {
        start_line: 1,
        end_line: snapshot_lines_count,
    }];
    let ranges = claim.ranges.as_ref().unwrap_or(&whole_file_range);

    if claim.snapshot_content == head_content {
        return ranges
            .iter()
            .map(|r| AttributedInterval {
                start: r.start_line,
                end: r.end_line,
                source: claim.source.clone(),
                viewed_at: claim.viewed_at,
            })
            .collect();
    }

    let hunks = diff_contents(&claim.snapshot_content, head_content);
    let segments = unchanged_segments(&hunks);
    let projected = project_ranges(ranges, &segments);

    projected
        .into_iter()
        .map(|p| AttributedInterval {
            start: p.start,
            end: p.end,
            source: claim.source.clone(),
            viewed_at: claim.viewed_at,
        })
        .collect()
}

fn same_source(a: &Option<ReviewSource>, b: &Option<ReviewSource>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(ReviewSource::File), Some(ReviewSource::File)) => true,
        (
            Some(ReviewSource::Range { block_id: id1, .. }),
            Some(ReviewSource::Range { block_id: id2, .. }),
        ) => id1 == id2,
        _ => false,
    }
}

pub fn split_range_by_claims(
    range: &Interval,
    coverage: &[AttributedInterval],
) -> Vec<ReviewRange> {
    let clipped: Vec<&AttributedInterval> = coverage
        .iter()
        .filter(|c| c.start <= range.end && c.end >= range.start)
        .collect();

    let mut breakpoints = BTreeSet::new();
    breakpoints.insert(range.start);
    if range.end < usize::MAX {
        breakpoints.insert(range.end + 1);
    }

    for c in &clipped {
        if c.start >= range.start && c.start <= range.end {
            breakpoints.insert(c.start);
        }
        if c.end < usize::MAX && c.end + 1 >= range.start && c.end <= range.end {
            breakpoints.insert(c.end + 1);
        }
    }

    let sorted: Vec<usize> = breakpoints.into_iter().collect();
    let mut result: Vec<ReviewRange> = Vec::new();

    for i in 0..sorted.len() - 1 {
        let seg_start = sorted[i];
        let seg_end = sorted[i + 1] - 1;
        if seg_start > seg_end {
            continue;
        }

        let covering: Vec<&&AttributedInterval> = clipped
            .iter()
            .filter(|c| c.start <= seg_start && c.end >= seg_end)
            .collect();

        let winner = covering.iter().max_by_key(|c| c.viewed_at).copied();

        let status = if winner.is_some() {
            "reviewed".to_string()
        } else {
            "new".to_string()
        };
        let reviewed_via = winner.map(|c| c.source.clone());

        if let Some(prev) = result.last_mut() {
            if prev.status == status
                && prev.end_line == seg_start - 1
                && same_source(&prev.reviewed_via, &reviewed_via)
            {
                prev.end_line = seg_end;
                continue;
            }
        }

        result.push(ReviewRange {
            start_line: seg_start,
            end_line: seg_end,
            status,
            reviewed_via,
        });
    }

    result
}

pub fn synthesize_reviewed_baseline(
    hunks: &[DiffHunk],
    head_content: &str,
    coverage: &[AttributedInterval],
) -> String {
    let head_lines = split_lines(head_content);
    let full_domain_runs = split_range_by_claims(
        &Interval {
            start: 1,
            end: head_lines.len().max(1),
        },
        coverage,
    );

    let is_reviewed_at = |line: usize| -> bool {
        if line < 1 || line > head_lines.len() {
            return false;
        }
        for run in &full_domain_runs {
            if line >= run.start_line && line <= run.end_line {
                return run.status == "reviewed";
            }
        }
        false
    };

    let mut sorted_hunks = hunks.to_vec();
    sorted_hunks.sort_by_key(|h| h.old_start);

    let mut output: Vec<String> = Vec::new();
    let mut head_cursor = 1usize;

    for hunk in sorted_hunks {
        let head_touched_start = if hunk.new_lines > 0 {
            hunk.new_start
        } else {
            hunk.new_start + 1
        };
        let head_touched_end = if hunk.new_lines > 0 {
            hunk.new_start + hunk.new_lines - 1
        } else {
            hunk.new_start
        };

        for line in head_cursor..head_touched_start {
            if line <= head_lines.len() {
                output.push(head_lines[line - 1].to_string());
            }
        }

        let removed: Vec<String> = hunk
            .lines
            .iter()
            .filter(|l| l.starts_with('-'))
            .map(|l| l[1..].to_string())
            .collect();
        let added: Vec<String> = hunk
            .lines
            .iter()
            .filter(|l| l.starts_with('+'))
            .map(|l| l[1..].to_string())
            .collect();

        if !removed.is_empty() {
            let both_reviewed = is_reviewed_at(head_touched_start.saturating_sub(1))
                && is_reviewed_at(head_touched_start);
            if !both_reviewed {
                output.extend(removed);
            }
        }

        for (idx, add_line) in added.into_iter().enumerate() {
            if is_reviewed_at(head_touched_start + idx) {
                output.push(add_line);
            }
        }

        head_cursor = head_touched_end + 1;
    }

    for line in head_cursor..=head_lines.len() {
        output.push(head_lines[line - 1].to_string());
    }

    if output.is_empty() {
        return String::new();
    }

    let joined = output.join("\n");
    if head_content.ends_with('\n') {
        format!("{}\n", joined)
    } else {
        joined
    }
}

pub fn reconcile(base_content: &str, head_content: &str, claims: &[ReviewClaim]) -> Reconciliation {
    let base_head_hunks = diff_contents(base_content, head_content);

    if claims.is_empty() {
        let ranges: Vec<ReviewRange> = base_head_hunks
            .iter()
            .filter(|h| h.new_lines > 0)
            .map(|h| ReviewRange {
                start_line: h.new_start,
                end_line: h.new_start + h.new_lines - 1,
                status: "new".to_string(),
                reviewed_via: None,
            })
            .collect();

        return Reconciliation {
            changed_since_review: !ranges.is_empty() || !base_head_hunks.is_empty(),
            ranges,
            reviewed_baseline: None,
        };
    }

    let mut coverage = Vec::new();
    for claim in claims {
        let per_claim = project_claim_coverage(claim, head_content);
        coverage.extend(per_claim);
    }

    let mut ranges = Vec::new();
    for hunk in &base_head_hunks {
        if hunk.new_lines > 0 {
            let hunk_range = Interval {
                start: hunk.new_start,
                end: hunk.new_start + hunk.new_lines - 1,
            };
            let split = split_range_by_claims(&hunk_range, &coverage);
            ranges.extend(split);
        }
    }

    let file_claim_changed = claims
        .iter()
        .any(|c| c.ranges.is_none() && c.snapshot_content != head_content);

    let reviewed_baseline = Some(synthesize_reviewed_baseline(
        &base_head_hunks,
        head_content,
        &coverage,
    ));

    let has_new_ranges = ranges.iter().any(|r| r.status == "new");

    Reconciliation {
        changed_since_review: file_claim_changed || has_new_ranges,
        ranges,
        reviewed_baseline,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unchanged_file_with_whole_file_claim() {
        let base = "line 1\nline 2\nline 3\n";
        let head = "line 1\nline 2_mod\nline 3\n";

        let claim = ReviewClaim {
            id: "c1".to_string(),
            session_id: "s1".to_string(),
            path: "test.txt".to_string(),
            source: ReviewSource::File,
            snapshot_hash: "hash1".to_string(),
            snapshot_content: head.to_string(),
            ranges: None,
            viewed_at: 100,
        };

        let result = reconcile(base, head, &[claim]);
        assert!(!result.changed_since_review);
        assert_eq!(result.ranges.len(), 1);
        assert_eq!(result.ranges[0].status, "reviewed");
        assert_eq!(result.ranges[0].start_line, 2);
        assert_eq!(result.ranges[0].end_line, 2);
    }

    #[test]
    fn test_file_edited_after_review_reveals_only_new_delta() {
        let base = "line 1\nline 2\nline 3\n";
        let snapshot = "line 1\nline 2_mod\nline 3\n";
        // User reviewed snapshot (line 2_mod). Later, an agent added line 4_agent at the bottom.
        let head = "line 1\nline 2_mod\nline 3\nline 4_agent\n";

        let claim = ReviewClaim {
            id: "c1".to_string(),
            session_id: "s1".to_string(),
            path: "test.txt".to_string(),
            source: ReviewSource::File,
            snapshot_hash: "hash1".to_string(),
            snapshot_content: snapshot.to_string(),
            ranges: None,
            viewed_at: 100,
        };

        let result = reconcile(base, head, &[claim]);
        assert!(result.changed_since_review);
        assert_eq!(result.ranges.len(), 2);
        // Line 2 was reviewed
        assert_eq!(result.ranges[0].status, "reviewed");
        assert_eq!(result.ranges[0].start_line, 2);
        assert_eq!(result.ranges[0].end_line, 2);
        // Line 4 is new
        assert_eq!(result.ranges[1].status, "new");
        assert_eq!(result.ranges[1].start_line, 4);
        assert_eq!(result.ranges[1].end_line, 4);

        // Baseline synthesis check
        let baseline = result.reviewed_baseline.unwrap();
        // Diffing baseline vs head will show ONLY line 4 as added!
        let delta_hunks = diff_contents(&baseline, head);
        assert_eq!(delta_hunks.len(), 1);
        assert_eq!(delta_hunks[0].new_start, 4);
        assert_eq!(delta_hunks[0].lines, vec!["+line 4_agent"]);
    }
}
