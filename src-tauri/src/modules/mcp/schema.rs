use serde_json::Value;

use voktty_tool_policy::MAX_SCHEMA_BYTES;

pub const MAX_SCHEMA_DEPTH: usize = 32;
pub const MAX_SCHEMA_NODES: usize = 4096;
pub const MAX_SCHEMA_PROPERTIES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SchemaError {
    NotAnObject,
    TooLarge,
    TooDeep,
    TooManyNodes,
    TooManyProperties,
    ExternalReference,
}

pub fn validate_schema(schema: &Value) -> Result<(), SchemaError> {
    if !schema.is_object() {
        return Err(SchemaError::NotAnObject);
    }
    if serde_json::to_vec(schema)
        .map_err(|_| SchemaError::TooLarge)?
        .len()
        > MAX_SCHEMA_BYTES
    {
        return Err(SchemaError::TooLarge);
    }

    let mut stack = vec![(schema, 1usize)];
    let mut nodes = 0usize;
    let mut properties = 0usize;
    while let Some((value, depth)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_SCHEMA_NODES {
            return Err(SchemaError::TooManyNodes);
        }
        if depth > MAX_SCHEMA_DEPTH {
            return Err(SchemaError::TooDeep);
        }
        match value {
            Value::Object(object) => {
                if object
                    .get("$ref")
                    .and_then(Value::as_str)
                    .is_some_and(is_external_reference)
                {
                    return Err(SchemaError::ExternalReference);
                }
                if let Some(Value::Object(schema_properties)) = object.get("properties") {
                    properties = properties.saturating_add(schema_properties.len());
                    if properties > MAX_SCHEMA_PROPERTIES {
                        return Err(SchemaError::TooManyProperties);
                    }
                }
                stack.extend(object.values().map(|child| (child, depth + 1)));
            }
            Value::Array(values) => {
                stack.extend(values.iter().map(|child| (child, depth + 1)));
            }
            _ => {}
        }
    }
    Ok(())
}

fn is_external_reference(reference: &str) -> bool {
    !reference.starts_with('#')
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn accepts_bounded_local_schema() {
        let schema = json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "$defs": { "name": { "type": "string" } }
        });

        assert_eq!(validate_schema(&schema), Ok(()));
    }

    #[test]
    fn rejects_network_schema_references() {
        for reference in [
            "https://attacker.invalid/schema.json",
            "HTTPS://attacker.invalid/schema.json",
            "../shared/schema.json",
            "//attacker.invalid/schema.json",
        ] {
            let schema = json!({ "$ref": reference });
            assert_eq!(
                validate_schema(&schema),
                Err(SchemaError::ExternalReference)
            );
        }
    }

    #[test]
    fn accepts_local_fragment_references() {
        let schema = json!({
            "$defs": { "name": { "type": "string" } },
            "properties": { "name": { "$ref": "#/$defs/name" } }
        });

        assert_eq!(validate_schema(&schema), Ok(()));
    }

    #[test]
    fn rejects_deep_schema() {
        let mut schema = json!({ "type": "string" });
        for _ in 0..MAX_SCHEMA_DEPTH {
            schema = json!({ "not": schema });
        }

        assert_eq!(validate_schema(&schema), Err(SchemaError::TooDeep));
    }
}
