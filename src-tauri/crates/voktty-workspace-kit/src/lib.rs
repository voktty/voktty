mod deployment;
mod document;
mod template;
mod validation;

use serde::Serialize;
use serde_json::Value;

include!(concat!(env!("OUT_DIR"), "/resources.rs"));

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Issue {
    pub code: &'static str,
    pub path: Vec<Value>,
}

impl Issue {
    fn new(code: &'static str, path: Vec<Value>) -> Self {
        Self { code, path }
    }
}

pub type KitResult<T> = Result<T, Vec<Issue>>;

pub fn resource(source: &str) -> Option<&'static str> {
    RESOURCES
        .iter()
        .find(|(path, _)| *path == source)
        .map(|(_, text)| *text)
}

pub use deployment::{
    plan_deployment, DeploymentAction, DeploymentEntry, DeploymentPlan, DeploymentReason, PathFact,
    RootLinks,
};
pub use template::{render_template, FileKind, RenderedFile};
pub use validation::{parse_agent_roster, parse_kit_config, PathCase};
