use super::*;
use crate::modules::project_memory::tests::{project, runtime, store};
use std::fs;
use voktty_memory_local::MemoryPreviewRequest;

struct MigrationWriter(PathBuf);
impl MemoryWriteAccess for MigrationWriter {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
            && !(path.ends_with("RULES.md") && self.0.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
}

#[test]
fn restoration_factory_grants_only_exact_targets_and_backups_under_its_original_lifetime() {
    let project = project();
    let (_state, store) = store();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    fs::create_dir(root.join(".voktty")).unwrap();
    fs::write(root.join(".voktty/.gitignore"), "*\n").unwrap();
    let source =
        NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
    runtime().block_on(async {
        let preview = MemoryWorkers::default().preview(MemoryPreviewRequest {
            store: store.clone(), origin: root.clone(), origin_access: source.access.clone(),
            destination: root.clone(), destination_access: source.access.clone(),
            inputs: serde_json::json!({"project_name":"Recovery authority", "created_at":"2026-11-03"}).as_object().unwrap().clone(),
            links: RootLinks::default(),
        }, DiscoveryControl::default()).unwrap().finish().await.unwrap();
        let failure = preview.publish(&MigrationWriter(root.clone()), &DiscoveryControl::default()).unwrap_err();
        let backup = failure.possible_recovery_files[0].clone();
        fs::remove_file(root.join(".voktty/.gitignore")).unwrap();
        let mut owner = NativeMemoryDeployment::default();
        let destination = NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
        let receipt = owner.reserve_recovery(destination, DiscoveryControl::default());
        let prepared = owner.prepare_recovery(&source, &receipt, store).unwrap().finish().await.unwrap();
        owner.accept_recovery(prepared).unwrap();
        let review = owner.review.as_ref().unwrap();
        let access = super::super::super::write_authority::NativeMemoryWriteAuthority::capture_recovery(
            &registry, owner.recovery(&receipt).unwrap(), source.access.clone(),
            review.destination.access.clone(), &review.live,
        ).unwrap();
        let target = root.join(".voktty/.gitignore");
        assert!(access.allows_create(&target));
        assert!(access.allows_remove_staging(&root.join(backup)));
        for path in [root.clone(), root.join(".voktty"), root.join("AGENTS.md"),
            root.join(".voktty/kit.json"), root.join(".voktty/.voktty-stage-12345678-1234-4234-8234-123456789abc"),
            root.join(".env"), root.join(".voktty/.voktty-migration-12345678-1234-4234-8234-123456789abc-127")] {
            assert!(!access.allows_create(&path));
            assert!(!access.allows_replace(&path));
            assert!(!access.allows_remove_staging(&path));
        }
        assert!(!access.allows_replace(&target));
        owner.clear();
        assert!(!access.allows_create(&target));
    });
}
