use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use voktty_memory_local::{measure_local_memory, DiscoveryControl, MemoryReadAccess, ReadError};
use voktty_workspace_kit::{handoff_created_at_ms, render_template};

struct Access {
    root: PathBuf,
    denied: Option<PathBuf>,
    reads: Mutex<Vec<PathBuf>>,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.denied.as_deref() != Some(path)
            && (path.starts_with(&self.root)
                || self.root.ancestors().any(|p| p == path)
                || self.root.ancestors().any(|p| {
                    path == p.join(".voktty") || path.parent() == Some(p.join(".voktty").as_path())
                }))
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.root.ancestors().any(|p| p == path) || path.starts_with(&self.root)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().push(path.to_owned());
        self.denied.as_deref() != Some(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.denied.as_deref() != Some(path)
    }
}

struct Fixture {
    _temporary: tempfile::TempDir,
    root: PathBuf,
    access: Access,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temporary.path()).unwrap();
        for file in render_template(
            serde_json::json!({"project_name":"Fixture", "created_at":"2026-11-01"})
                .as_object()
                .unwrap(),
        )
        .unwrap()
        {
            if !file.path.starts_with(".voktty/") {
                continue;
            }
            let path = root.join(file.path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, file.text).unwrap();
        }
        Self {
            _temporary: temporary,
            access: Access {
                root: root.clone(),
                denied: None,
                reads: Mutex::new(vec![]),
            },
            root,
        }
    }

    fn measure(&self) -> Result<serde_json::Value, ReadError> {
        measure_local_memory(
            &self.root,
            &self.access,
            handoff_created_at_ms("2026-11-01-0000-solo.md").unwrap(),
            "Up next",
            &DiscoveryControl::default(),
        )
        .map(|result| serde_json::to_value(result).unwrap())
    }
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn collect(root: &Path, map: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in std::fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                collect(&path, map);
            } else {
                map.insert(path.clone(), std::fs::read(path).unwrap());
            }
        }
    }
    let mut result = BTreeMap::new();
    collect(root, &mut result);
    result
}

#[test]
fn stateless_measurement_reports_real_limits_without_reading_instructions_or_runtime_state() {
    let fixture = Fixture::new();
    std::fs::write(fixture.root.join(".voktty/CONTEXT.md"), "é😀".repeat(2001)).unwrap();
    std::fs::write(
        fixture.root.join(".voktty/plans/TRACKING.md"),
        format!("## Up next\n{}", "- item\n".repeat(21)),
    )
    .unwrap();
    std::fs::write(
        fixture
            .root
            .join(".voktty/continuity/handoffs/2026-09-01-0000-solo.md"),
        "UNREAD HANDOFF BODY",
    )
    .unwrap();
    std::fs::create_dir(fixture.root.join(".voktty/state")).unwrap();
    std::fs::write(
        fixture.root.join(".voktty/state/private.json"),
        "UNREAD RUNTIME",
    )
    .unwrap();
    let before = snapshot(&fixture.root);
    let result = fixture.measure().unwrap();
    assert_eq!(result["report"]["complete"], true);
    assert_eq!(result["report"]["exceeded"], true);
    let entries = result["report"]["measurements"].as_array().unwrap();
    assert!(entries
        .iter()
        .any(|m| m["path"] == "CONTEXT.md" && m["value"] == 4002 && m["status"] == "exceeded"));
    assert!(entries
        .iter()
        .any(|m| m["metric"] == "up-next" && m["value"] == 21));
    assert!(entries
        .iter()
        .any(|m| m["metric"] == "age-ms" && m["status"] == "exceeded"));
    assert_eq!(snapshot(&fixture.root), before);
    let reads = fixture.access.reads.lock().unwrap();
    assert!(reads.iter().all(|p| p.ends_with("kit.json")
        || p.ends_with("CONTEXT.md")
        || p.ends_with("PROJECT.md")
        || p.ends_with("plans/INDEX.md")
        || p.ends_with("plans/TRACKING.md")
        || p.ends_with("continuity/CHANGELOG.md")));
}

#[test]
fn missing_documents_and_missing_inventory_remain_unknown_instead_of_empty() {
    let fixture = Fixture::new();
    std::fs::remove_file(fixture.root.join(".voktty/PROJECT.md")).unwrap();
    std::fs::remove_dir_all(fixture.root.join(".voktty/continuity/handoffs")).unwrap();
    let result = fixture.measure().unwrap();
    assert_eq!(result["report"]["complete"], false);
    for entry in result["report"]["measurements"].as_array().unwrap() {
        if entry["path"] == "PROJECT.md" || entry["path"] == "continuity/handoffs/" {
            assert_eq!(entry["status"], "unknown");
            assert!(entry["value"].is_null());
        }
    }
}

#[test]
fn unparseable_or_future_handoff_dates_do_not_hide_the_observed_file_count() {
    for name in ["legacy.md", "2099-01-01-0000-solo.md"] {
        let fixture = Fixture::new();
        std::fs::write(
            fixture.root.join(".voktty/continuity/handoffs").join(name),
            "unread",
        )
        .unwrap();
        let result = fixture.measure().unwrap();
        let entries = result["report"]["measurements"].as_array().unwrap();
        assert!(entries
            .iter()
            .any(|m| m["metric"] == "files" && m["value"] == 1));
        assert!(entries
            .iter()
            .any(|m| m["metric"] == "age-ms" && m["status"] == "unknown"));
    }
}

#[test]
fn denied_enumeration_and_cancelled_requests_cannot_publish_a_measurement() {
    let mut fixture = Fixture::new();
    fixture.access.denied = Some(fixture.root.join(".voktty/continuity/handoffs"));
    assert_eq!(fixture.measure().unwrap_err(), ReadError::Denied);
    let control = DiscoveryControl::default();
    control.cancel();
    assert!(matches!(
        measure_local_memory(&fixture.root, &fixture.access, 0, "Up next", &control),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        measure_local_memory(
            &fixture.root,
            &fixture.access,
            0,
            "",
            &DiscoveryControl::default()
        ),
        Err(ReadError::Contract(_))
    ));
}

#[test]
fn absent_or_nested_kits_are_not_a_zero_sized_memory() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.root.join("child")).unwrap();
    let child = fixture.root.join("child");
    let result = measure_local_memory(
        &child,
        &fixture.access,
        0,
        "Up next",
        &DiscoveryControl::default(),
    )
    .unwrap();
    assert_eq!(result.root, fixture.root);
    std::fs::create_dir(child.join(".voktty")).unwrap();
    std::fs::copy(
        fixture.root.join(".voktty/kit.json"),
        child.join(".voktty/kit.json"),
    )
    .unwrap();
    assert!(matches!(
        measure_local_memory(
            &child,
            &fixture.access,
            0,
            "Up next",
            &DiscoveryControl::default()
        ),
        Err(ReadError::Unavailable)
    ));
    std::fs::remove_dir_all(fixture.root.join(".voktty")).unwrap();
    assert_eq!(fixture.measure().unwrap_err(), ReadError::Unavailable);
}

#[cfg(unix)]
#[test]
fn symlinked_documents_and_handoffs_never_read_the_outside_target() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside.md");
    std::fs::write(&outside, "UNREAD OUTSIDE BODY").unwrap();
    std::fs::remove_file(fixture.root.join(".voktty/CONTEXT.md")).unwrap();
    std::os::unix::fs::symlink(&outside, fixture.root.join(".voktty/CONTEXT.md")).unwrap();
    std::os::unix::fs::symlink(
        &outside,
        fixture
            .root
            .join(".voktty/continuity/handoffs/2026-10-01-0000-solo.md"),
    )
    .unwrap();
    let result = fixture.measure().unwrap();
    let entries = result["report"]["measurements"].as_array().unwrap();
    assert!(entries
        .iter()
        .any(|m| m["path"] == "CONTEXT.md" && m["status"] == "unknown"));
    assert!(entries
        .iter()
        .filter(|m| m["path"] == "continuity/handoffs/")
        .all(|m| m["status"] == "unknown"));
    assert!(!fixture.access.reads.lock().unwrap().contains(&outside));
}

struct DuringRead<'a> {
    access: &'a Access,
    mutation: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    retired: std::sync::atomic::AtomicBool,
    retire: bool,
}

impl MemoryReadAccess for DuringRead<'_> {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.access.allows_metadata(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        !self.retired.load(std::sync::atomic::Ordering::SeqCst)
            && self.access.allows_workspace_root(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.access.allows_enumeration(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        if path.ends_with(".voktty/CONTEXT.md") {
            if let Some(mutation) = self.mutation.lock().unwrap().take() {
                mutation();
            }
            if self.retire {
                self.retired
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        self.access.allows_read(path)
    }
}

#[test]
fn changed_configuration_and_retired_authority_reject_in_flight_results() {
    for retire in [false, true] {
        let fixture = Fixture::new();
        let path = fixture.root.join(".voktty/kit.json");
        let access = DuringRead {
            access: &fixture.access,
            retire,
            retired: std::sync::atomic::AtomicBool::new(false),
            mutation: Mutex::new(Some(Box::new(move || {
                if retire {
                    return;
                }
                let mut config: serde_json::Value =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                config["limits"]["CONTEXT.md"]["maxChars"] = 1.into();
                std::fs::write(path, config.to_string()).unwrap();
            }))),
        };
        assert!(measure_local_memory(
            &fixture.root,
            &access,
            0,
            "Up next",
            &DiscoveryControl::default()
        )
        .is_err());
    }
}

#[cfg(unix)]
#[test]
fn replacing_the_kit_during_a_read_cannot_publish_the_old_handle_measurements() {
    let fixture = Fixture::new();
    let root = fixture.root.clone();
    let access = DuringRead {
        access: &fixture.access,
        retire: false,
        retired: std::sync::atomic::AtomicBool::new(false),
        mutation: Mutex::new(Some(Box::new(move || {
            std::fs::rename(root.join(".voktty"), root.join("old-kit")).unwrap();
            std::fs::create_dir(root.join(".voktty")).unwrap();
            std::fs::copy(root.join("old-kit/kit.json"), root.join(".voktty/kit.json")).unwrap();
        }))),
    };
    assert!(measure_local_memory(
        &fixture.root,
        &access,
        0,
        "Up next",
        &DiscoveryControl::default()
    )
    .is_err());
}

#[test]
fn an_exhausted_inventory_limit_never_publishes_a_partial_count_as_complete() {
    let fixture = Fixture::new();
    let handoffs = fixture.root.join(".voktty/continuity/handoffs");
    for index in 0..20001 {
        std::fs::write(
            handoffs.join(format!("2026-10-01-0000-agent-{index}.md")),
            "",
        )
        .unwrap();
    }
    let result = fixture.measure().unwrap();
    assert_eq!(result["report"]["complete"], false);
    assert!(result["report"]["measurements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["path"] == "continuity/handoffs/")
        .all(|m| m["status"] == "unknown"));
}
