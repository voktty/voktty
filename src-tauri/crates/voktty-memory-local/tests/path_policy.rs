use serde::Deserialize;
use voktty_memory_local::path_policy::{readable, writable};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    path: String,
    readable: bool,
    writable: bool,
}

#[test]
fn conforms_to_the_shared_frontend_secret_path_policy() {
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../../src/lib/pathSafetyConformance.json"
    ))
    .unwrap();
    assert_eq!(cases.len(), 45);
    for case in cases {
        assert_eq!(readable(&case.path), case.readable, "read {}", case.path);
        assert_eq!(writable(&case.path), case.writable, "write {}", case.path);
    }
}
