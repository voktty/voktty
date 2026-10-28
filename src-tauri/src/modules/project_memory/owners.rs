use super::*;
use std::collections::HashMap;
use std::sync::Weak;

const MAX_WINDOWS: usize = 64;
const MAX_PRESENTATIONS: usize = 256;

#[derive(Default)]
pub struct NativeMemoryOwners {
    windows: HashMap<String, WindowOwner>,
}

struct WindowOwner {
    identity: Arc<()>,
    presentations: Vec<Presentation>,
}

struct Presentation {
    identity: Arc<()>,
    selection: NativeMemorySelection,
}

#[derive(Clone)]
pub struct NativeMemoryWindowReceipt {
    label: String,
    identity: Weak<()>,
}

#[derive(Clone)]
pub struct NativeMemoryPresentationReceipt {
    identity: Weak<()>,
}

impl NativeMemoryOwners {
    pub fn register_window(
        &mut self,
        label: &str,
    ) -> Result<NativeMemoryWindowReceipt, MemoryWorkError> {
        if label.is_empty()
            || label.len() > 128
            || !label
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_:/.".contains(&c))
        {
            return Err(ReadError::InvalidInput.into());
        }
        if !self.windows.contains_key(label) && self.windows.len() >= MAX_WINDOWS {
            return Err(ReadError::Limit.into());
        }
        let identity = Arc::new(());
        let receipt = NativeMemoryWindowReceipt {
            label: label.to_owned(),
            identity: Arc::downgrade(&identity),
        };
        self.windows.insert(
            label.to_owned(),
            WindowOwner {
                identity,
                presentations: Vec::new(),
            },
        );
        Ok(receipt)
    }

    fn window(&self, receipt: &NativeMemoryWindowReceipt) -> Option<&WindowOwner> {
        self.windows
            .get(&receipt.label)
            .filter(|window| Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&window.identity)))
    }

    fn window_mut(&mut self, receipt: &NativeMemoryWindowReceipt) -> Option<&mut WindowOwner> {
        self.windows
            .get_mut(&receipt.label)
            .filter(|window| Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&window.identity)))
    }

    pub fn retire_window(&mut self, receipt: &NativeMemoryWindowReceipt) -> bool {
        if self.window(receipt).is_none() {
            return false;
        }
        self.windows.remove(&receipt.label);
        true
    }

    pub fn open_presentation(
        &mut self,
        window: &NativeMemoryWindowReceipt,
    ) -> Result<NativeMemoryPresentationReceipt, MemoryWorkError> {
        self.window(window).ok_or(ReadError::Cancelled)?;
        if self
            .windows
            .values()
            .map(|w| w.presentations.len())
            .sum::<usize>()
            >= MAX_PRESENTATIONS
        {
            return Err(ReadError::Limit.into());
        }
        let identity = Arc::new(());
        let receipt = NativeMemoryPresentationReceipt {
            identity: Arc::downgrade(&identity),
        };
        self.window_mut(window)
            .ok_or(ReadError::Cancelled)?
            .presentations
            .push(Presentation {
                identity,
                selection: NativeMemorySelection::default(),
            });
        Ok(receipt)
    }

    pub fn close_presentation(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryPresentationReceipt,
    ) -> bool {
        let Some(window) = self.window_mut(window) else {
            return false;
        };
        let Some(index) = window.presentations.iter().position(|presentation| {
            Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&presentation.identity))
        }) else {
            return false;
        };
        window.presentations.swap_remove(index);
        true
    }

    pub fn select(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryPresentationReceipt,
        registry: &WorkspaceRegistry,
        requested: PathBuf,
        environment: &WorkspaceEnv,
    ) -> Result<NativeMemorySelectionReceipt, MemoryWorkError> {
        self.window_mut(window)
            .and_then(|window| {
                window.presentations.iter_mut().find(|presentation| {
                    Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&presentation.identity))
                })
            })
            .ok_or(ReadError::Cancelled)?
            .selection
            .select(registry, requested, environment)
    }

    pub fn selection(
        &self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryPresentationReceipt,
    ) -> Result<&NativeMemorySelection, MemoryWorkError> {
        self.window(window)
            .and_then(|window| {
                window.presentations.iter().find(|presentation| {
                    Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&presentation.identity))
                })
            })
            .map(|presentation| &presentation.selection)
            .ok_or_else(|| ReadError::Cancelled.into())
    }
}
