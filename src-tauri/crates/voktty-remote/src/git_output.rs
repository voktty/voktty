use std::io::{self, Read};

#[derive(Default)]
pub(crate) struct CappedOutput {
    pub bytes: Vec<u8>,
    pub truncated: bool,
}

pub(crate) fn read_capped(mut reader: impl Read, limit: usize) -> io::Result<CappedOutput> {
    let mut output = CappedOutput {
        bytes: Vec::with_capacity(limit.min(8 * 1024)),
        truncated: false,
    };
    let mut buffer = [0; 8 * 1024];

    loop {
        let count = match reader.read(&mut buffer) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            return Ok(output);
        }
        let available = limit.saturating_sub(output.bytes.len());
        let retained = count.min(available);
        output.bytes.extend_from_slice(&buffer[..retained]);
        output.truncated |= retained < count;
    }
}

#[cfg(test)]
mod tests {
    use super::read_capped;
    use std::io::Cursor;

    #[test]
    fn caps_captured_bytes_while_draining_the_pipe() {
        let input = Cursor::new(b"abcdef".to_vec());
        let mut reader = input;

        let captured = read_capped(&mut reader, 3).expect("read output");

        assert_eq!(captured.bytes, b"abc");
        assert!(captured.truncated);
        assert_eq!(reader.position(), 6);
    }

    #[test]
    fn reports_complete_output_when_it_fits() {
        let captured = read_capped(Cursor::new(b"abc"), 3).expect("read output");

        assert_eq!(captured.bytes, b"abc");
        assert!(!captured.truncated);
    }
}
