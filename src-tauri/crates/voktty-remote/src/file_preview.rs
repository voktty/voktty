use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

pub(crate) const MAX_PREVIEW_PATH_BYTES: usize = 4 * 1024;
const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PREVIEW_LINES: usize = 12;
const MAX_PREVIEW_LINE_CHARS: usize = 200;

pub(crate) fn read_file_preview(
    path: &Path,
    max_lines: usize,
    start_line: usize,
) -> Result<Vec<String>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file.take(MAX_PREVIEW_BYTES));
    let mut line_buffer = String::new();
    let mut line_number = 1usize;
    let mut lines = Vec::with_capacity(max_lines.clamp(1, MAX_PREVIEW_LINES));

    while lines.len() < max_lines.clamp(1, MAX_PREVIEW_LINES) {
        line_buffer.clear();
        if reader
            .read_line(&mut line_buffer)
            .map_err(|error| error.to_string())?
            == 0
        {
            break;
        }

        if line_number >= start_line.max(1) {
            let line = line_buffer
                .strip_suffix('\n')
                .map(|line| line.strip_suffix('\r').unwrap_or(line))
                .unwrap_or(&line_buffer);
            if line.contains('\0') {
                return Err("Binary file".to_string());
            }
            let mut line = line.to_string();
            if line.chars().count() > MAX_PREVIEW_LINE_CHARS {
                line = line.chars().take(MAX_PREVIEW_LINE_CHARS - 1).collect();
                line.push('…');
            }
            lines.push(line);
        }

        line_number = line_number.saturating_add(1);
    }

    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn reads_requested_lines_and_truncates_long_utf8_lines() {
        let directory = tempdir().expect("workspace");
        let path = directory.path().join("preview.txt");
        let long_line = "é".repeat(250);
        std::fs::write(&path, format!("skip\r\nfirst\n{long_line}\nlast\n")).expect("text file");

        let lines = read_file_preview(&path, 2, 2).expect("preview");
        assert_eq!(lines[0], "first");
        assert!(lines[1].ends_with('…'));
        assert_eq!(lines[1].chars().count(), MAX_PREVIEW_LINE_CHARS);
    }

    #[test]
    fn previews_large_files_without_reading_the_entire_file() {
        let directory = tempdir().expect("workspace");
        let path = directory.path().join("large.txt");
        let mut file = File::create(&path).expect("large file");
        file.write_all(b"first\nsecond\n").expect("prefix");
        file.set_len(MAX_PREVIEW_BYTES + 1).expect("extend file");

        assert_eq!(
            read_file_preview(&path, 2, 1).expect("preview"),
            ["first", "second"]
        );
    }

    #[test]
    fn caps_the_requested_number_of_preview_lines() {
        let directory = tempdir().expect("workspace");
        let path = directory.path().join("many-lines.txt");
        std::fs::write(
            &path,
            (0..20).map(|line| format!("{line}\n")).collect::<String>(),
        )
        .expect("text file");

        assert_eq!(
            read_file_preview(&path, usize::MAX, 1)
                .expect("preview")
                .len(),
            MAX_PREVIEW_LINES
        );
    }

    #[test]
    fn bounds_scanning_when_requested_lines_follow_a_huge_line() {
        let directory = tempdir().expect("workspace");
        let path = directory.path().join("long-line.txt");
        let file = File::create(&path).expect("text file");
        file.set_len(MAX_PREVIEW_BYTES + 1).expect("extend file");

        assert!(read_file_preview(&path, 1, 2).expect("preview").is_empty());
    }
}
