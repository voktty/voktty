use crate::ReadError;
use serde_json::{Map, Value};

pub(crate) fn validate_inputs(inputs: &Map<String, Value>) -> Result<(), ReadError> {
    if inputs.len() > 32 {
        return Err(ReadError::Limit);
    }
    let mut bytes = 0usize;
    for (name, value) in inputs {
        let text = value.as_str().ok_or(ReadError::InvalidInput)?;
        if name.len() > 64 || text.len() > 16 * 1024 {
            return Err(ReadError::Limit);
        }
        bytes += name.len() + text.len();
        if bytes > 256 * 1024 {
            return Err(ReadError::Limit);
        }
    }
    Ok(())
}
