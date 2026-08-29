use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<String>,
}

pub fn split_lines(content: &str) -> Vec<&str> {
    if content.is_empty() {
        return Vec::new();
    }
    let trimmed = content
        .strip_suffix("\r\n")
        .or_else(|| content.strip_suffix('\n'))
        .unwrap_or(content);
    if trimmed.is_empty() {
        return Vec::new();
    }
    trimmed
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

/// Computes the Longest Common Subsequence edit script between two sets of lines.
/// Returns a sequence of (Operation, line_content) where Operation is '-', '+', or ' '.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DiffOp {
    Context,
    Delete,
    Insert,
}

fn compute_lcs_diff<'a>(a: &[&'a str], b: &[&'a str]) -> Vec<(DiffOp, &'a str)> {
    let n = a.len();
    let m = b.len();

    // Fast paths
    if n == 0 && m == 0 {
        return Vec::new();
    }
    if n == 0 {
        return b.iter().map(|&line| (DiffOp::Insert, line)).collect();
    }
    if m == 0 {
        return a.iter().map(|&line| (DiffOp::Delete, line)).collect();
    }

    // Dynamic programming table for LCS
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in 0..n {
        for j in 0..m {
            if a[i] == b[j] {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = dp[i + 1][j].max(dp[i][j + 1]);
            }
        }
    }

    // Backtrack to build diff script
    let mut script = Vec::new();
    let mut i = n;
    let mut j = m;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && a[i - 1] == b[j - 1] {
            script.push((DiffOp::Context, a[i - 1]));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            script.push((DiffOp::Insert, b[j - 1]));
            j -= 1;
        } else if i > 0 && (j == 0 || dp[i][j - 1] < dp[i - 1][j]) {
            script.push((DiffOp::Delete, a[i - 1]));
            i -= 1;
        }
    }

    script.reverse();
    script
}

/// Converts two raw string contents into unified diff hunks with 1-based indexing.
pub fn diff_contents(old_content: &str, new_content: &str) -> Vec<DiffHunk> {
    if old_content == new_content {
        return Vec::new();
    }

    let a_lines = split_lines(old_content);
    let b_lines = split_lines(new_content);

    let script = compute_lcs_diff(&a_lines, &b_lines);
    if script.is_empty() {
        return Vec::new();
    }

    let mut hunks = Vec::new();
    let mut old_cursor = 1usize;
    let mut new_cursor = 1usize;

    let mut in_hunk = false;
    let mut current_hunk_old_start = 1usize;
    let mut current_hunk_new_start = 1usize;
    let mut current_hunk_old_lines = 0usize;
    let mut current_hunk_new_lines = 0usize;
    let mut current_hunk_lines = Vec::new();

    for (op, line) in script {
        match op {
            DiffOp::Context => {
                if in_hunk {
                    hunks.push(DiffHunk {
                        old_start: current_hunk_old_start,
                        old_lines: current_hunk_old_lines,
                        new_start: current_hunk_new_start,
                        new_lines: current_hunk_new_lines,
                        lines: std::mem::take(&mut current_hunk_lines),
                    });
                    in_hunk = false;
                    current_hunk_old_lines = 0;
                    current_hunk_new_lines = 0;
                }
                old_cursor += 1;
                new_cursor += 1;
            }
            DiffOp::Delete => {
                if !in_hunk {
                    in_hunk = true;
                    current_hunk_old_start = old_cursor;
                    current_hunk_new_start = new_cursor;
                } else if current_hunk_old_lines == 0 {
                    current_hunk_old_start = old_cursor;
                }
                current_hunk_old_lines += 1;
                current_hunk_lines.push(format!("-{}", line));
                old_cursor += 1;
            }
            DiffOp::Insert => {
                if !in_hunk {
                    in_hunk = true;
                    current_hunk_old_start = old_cursor.saturating_sub(1);
                    current_hunk_new_start = new_cursor;
                }
                current_hunk_new_lines += 1;
                current_hunk_lines.push(format!("+{}", line));
                new_cursor += 1;
            }
        }
    }

    if in_hunk {
        hunks.push(DiffHunk {
            old_start: current_hunk_old_start,
            old_lines: current_hunk_old_lines,
            new_start: current_hunk_new_start,
            new_lines: current_hunk_new_lines,
            lines: current_hunk_lines,
        });
    }

    hunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_identical_strings() {
        let hunks = diff_contents("hello\nworld", "hello\nworld");
        assert!(hunks.is_empty());
    }

    #[test]
    fn test_diff_pure_insertion() {
        let hunks = diff_contents("", "line 1\nline 2");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 0);
        assert_eq!(hunks[0].old_lines, 0);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_lines, 2);
        assert_eq!(hunks[0].lines, vec!["+line 1", "+line 2"]);
    }

    #[test]
    fn test_diff_pure_deletion() {
        let hunks = diff_contents("line 1\nline 2", "");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 2);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_lines, 0);
        assert_eq!(hunks[0].lines, vec!["-line 1", "-line 2"]);
    }

    #[test]
    fn test_diff_modified_middle() {
        let old = "a\nb\nc\nd";
        let new = "a\nb_mod\nc\nd";
        let hunks = diff_contents(old, new);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 2);
        assert_eq!(hunks[0].old_lines, 1);
        assert_eq!(hunks[0].new_start, 2);
        assert_eq!(hunks[0].new_lines, 1);
        assert_eq!(hunks[0].lines, vec!["-b", "+b_mod"]);
    }

    #[test]
    fn test_crlf_normalization() {
        let old = "a\r\nb\r\n";
        let new = "a\r\nb_mod\r\n";
        let hunks = diff_contents(old, new);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 2);
        assert_eq!(hunks[0].new_start, 2);
    }
}
