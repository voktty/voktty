const MAX_LINE_BYTES: usize = 64 * 1024;
const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_EVENT_NAME_BYTES: usize = 256;
const MAX_EVENT_ID_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SseEvent {
    pub event: Option<String>,
    pub id: Option<String>,
    pub data: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SseError {
    InvalidUtf8,
    LineTooLarge,
    EventTooLarge,
    InvalidField,
}

#[derive(Default)]
pub(crate) struct SseDecoder {
    buffer: Vec<u8>,
    event: Option<String>,
    id: Option<String>,
    data: String,
}

impl SseDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<SseEvent>, SseError> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            if position > MAX_LINE_BYTES {
                return Err(SseError::LineTooLarge);
            }
            let mut line: Vec<u8> = self.buffer.drain(..=position).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.consume_line(&line, &mut events)?;
        }
        if self.buffer.len() > MAX_LINE_BYTES {
            return Err(SseError::LineTooLarge);
        }
        Ok(events)
    }

    pub fn finish(&mut self) -> Result<Option<SseEvent>, SseError> {
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.consume_line(&line, &mut Vec::new())?;
        }
        Ok(self.dispatch())
    }

    fn consume_line(&mut self, bytes: &[u8], events: &mut Vec<SseEvent>) -> Result<(), SseError> {
        let line = std::str::from_utf8(bytes).map_err(|_| SseError::InvalidUtf8)?;
        if line.is_empty() {
            if let Some(event) = self.dispatch() {
                events.push(event);
            }
            return Ok(());
        }
        if line.starts_with(':') {
            return Ok(());
        }
        let (field, value) = line
            .split_once(':')
            .map(|(field, value)| (field, value.strip_prefix(' ').unwrap_or(value)))
            .unwrap_or((line, ""));
        match field {
            "event" if value.len() <= MAX_EVENT_NAME_BYTES => self.event = Some(value.into()),
            "id" if value.len() <= MAX_EVENT_ID_BYTES && !value.contains('\0') => {
                self.id = Some(value.into())
            }
            "data" => {
                let next = self
                    .data
                    .len()
                    .saturating_add(value.len())
                    .saturating_add(1);
                if next > MAX_EVENT_BYTES {
                    return Err(SseError::EventTooLarge);
                }
                self.data.push_str(value);
                self.data.push('\n');
            }
            "retry" => {}
            "event" | "id" => return Err(SseError::InvalidField),
            _ => {}
        }
        Ok(())
    }

    fn dispatch(&mut self) -> Option<SseEvent> {
        if self.data.is_empty() {
            self.event = None;
            return None;
        }
        self.data.pop();
        Some(SseEvent {
            event: self.event.take(),
            id: self.id.clone(),
            data: std::mem::take(&mut self.data),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmented_and_multiline_events_are_reassembled() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"event: mes").unwrap().is_empty());
        let events = decoder
            .push(b"sage\nid: 7\ndata: {\"a\":\ndata: 1}\n\n")
            .unwrap();

        assert_eq!(
            events,
            vec![SseEvent {
                event: Some("message".into()),
                id: Some("7".into()),
                data: "{\"a\":\n1}".into(),
            }]
        );
    }

    #[test]
    fn comments_and_unknown_fields_are_ignored() {
        let mut decoder = SseDecoder::default();
        let events = decoder
            .push(b": keepalive\nunknown: value\ndata: ok\n\n")
            .unwrap();

        assert_eq!(events[0].data, "ok");
    }

    #[test]
    fn oversized_lines_and_events_are_rejected() {
        let mut line = SseDecoder::default();
        assert_eq!(
            line.push(&vec![b'x'; MAX_LINE_BYTES + 1]),
            Err(SseError::LineTooLarge)
        );

        let mut event = SseDecoder::default();
        let line = format!("data: {}\n", "x".repeat(60 * 1024));
        let payload = line.repeat(18);
        assert_eq!(event.push(payload.as_bytes()), Err(SseError::EventTooLarge));
    }

    #[test]
    fn null_event_ids_are_rejected() {
        let mut decoder = SseDecoder::default();
        assert_eq!(
            decoder.push(b"id: unsafe\0id\ndata: value\n\n"),
            Err(SseError::InvalidField)
        );
    }
}
