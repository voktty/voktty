use std::fs;
use std::io::Read;
use std::path::PathBuf;

pub(crate) const MAX_LINE_COUNT_FILES: usize = 20_000;
pub(crate) const MAX_LINE_COUNT_PATH_BYTES: usize = 4 * 1024 * 1024;
const MAX_LINE_COUNT_FILE_BYTES: u64 = 1024 * 1024;
const MAX_LINE_COUNT_TOTAL_BYTES: u64 = 8 * 1024 * 1024;

pub(crate) fn count_text_lines(paths: &[PathBuf]) -> Vec<u64> {
    let mut remaining_bytes = MAX_LINE_COUNT_TOTAL_BYTES;
    paths
        .iter()
        .map(|path| count_text_lines_in_file(path, &mut remaining_bytes))
        .collect()
}

fn count_text_lines_in_file(path: &PathBuf, remaining_bytes: &mut u64) -> u64 {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_LINE_COUNT_FILE_BYTES
        || metadata.len() > *remaining_bytes
        || *remaining_bytes == 0
    {
        return 0;
    }

    let limit = metadata.len();
    let mut bytes = Vec::new();
    let read_result =
        fs::File::open(path).and_then(|file| file.take(limit).read_to_end(&mut bytes));
    *remaining_bytes = remaining_bytes.saturating_sub(bytes.len() as u64);
    let unchanged = fs::metadata(path).is_ok_and(|current| {
        current.len() == metadata.len() && current.modified().ok() == metadata.modified().ok()
    });
    if read_result.is_err()
        || !unchanged
        || bytes.is_empty()
        || bytes.len() as u64 != metadata.len()
        || bytes.len() as u64 > MAX_LINE_COUNT_FILE_BYTES
        || bytes.contains(&0)
    {
        return 0;
    }

    let lines = bytes.iter().filter(|byte| **byte == b'\n').count() as u64;
    if bytes.last() == Some(&b'\n') {
        lines
    } else {
        lines.saturating_add(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn counts_text_lines_and_skips_empty_or_binary_files() {
        let directory = tempdir().expect("workspace");
        let no_final_newline = directory.path().join("no-final-newline.txt");
        let final_newline = directory.path().join("final-newline.txt");
        let empty = directory.path().join("empty.txt");
        let binary = directory.path().join("binary.txt");
        fs::write(&no_final_newline, "one\ntwo").expect("text file");
        fs::write(&final_newline, "one\ntwo\n").expect("text file");
        fs::write(&empty, "").expect("empty file");
        fs::write(&binary, b"one\0two\n").expect("binary file");

        assert_eq!(
            count_text_lines(&[no_final_newline, final_newline, empty, binary,]),
            [2, 2, 0, 0]
        );
    }

    #[test]
    fn bounds_per_file_and_total_bytes() {
        let directory = tempdir().expect("workspace");
        let oversized = directory.path().join("oversized.txt");
        fs::write(
            &oversized,
            vec![b'x'; MAX_LINE_COUNT_FILE_BYTES as usize + 1],
        )
        .expect("oversized file");

        let mut paths = Vec::new();
        for index in 0..(MAX_LINE_COUNT_TOTAL_BYTES / MAX_LINE_COUNT_FILE_BYTES) {
            let path = directory.path().join(format!("bounded-{index}.txt"));
            fs::write(&path, vec![b'x'; MAX_LINE_COUNT_FILE_BYTES as usize]).expect("bounded file");
            paths.push(path);
        }
        let after_budget = directory.path().join("after-budget.txt");
        fs::write(&after_budget, "one line").expect("small file");
        paths.extend([oversized, after_budget]);

        assert_eq!(
            count_text_lines(&paths),
            [
                vec![1; (MAX_LINE_COUNT_TOTAL_BYTES / MAX_LINE_COUNT_FILE_BYTES) as usize],
                vec![0, 0]
            ]
            .concat()
        );
    }
}
