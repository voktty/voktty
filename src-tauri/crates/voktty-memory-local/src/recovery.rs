#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryRestore {
    pub target: String,
    pub backup: String,
    pub text: String,
}
