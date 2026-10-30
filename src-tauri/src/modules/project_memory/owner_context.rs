use super::*;
use voktty_memory_local::{MemoryContextRead, MemorySessionUse, MemoryTrustError};

const MAX_CONTEXTS: usize = 256;

impl NativeMemoryOwners {
    pub fn open_context(
        &mut self,
        window: &NativeMemoryWindowReceipt,
    ) -> Result<NativeMemoryContextReceipt, MemoryWorkError> {
        self.window(window).ok_or(ReadError::Cancelled)?;
        if self
            .windows
            .values()
            .map(|window| window.contexts.len())
            .sum::<usize>()
            >= MAX_CONTEXTS
        {
            return Err(ReadError::Limit.into());
        }
        let identity = Arc::new(());
        let receipt = NativeMemoryContextReceipt {
            identity: Arc::downgrade(&identity),
        };
        self.window_mut(window)
            .ok_or(ReadError::Cancelled)?
            .contexts
            .push(ContextOwner {
                identity,
                context: None,
                binding: None,
            });
        Ok(receipt)
    }

    pub fn bind_context_session(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        target: NativeMemoryContextTarget<'_>,
        review: NativeMemoryTrustReview,
        choice: MemorySessionUse,
        control: DiscoveryControl,
    ) -> Result<NativeMemoryContextBinding, MemoryTrustError> {
        let owner = self.context_owner(window, target.context)?;
        if owner.context.is_some() {
            return Err(ReadError::Cancelled.into());
        }
        if owner.binding.is_some() {
            return Err(ReadError::Busy.into());
        }
        let binding = self
            .selection_mut(window, target.presentation)?
            .bind_context_session(
                target.context,
                target.selected,
                review,
                choice,
                control.clone(),
            )?;
        self.context_owner_mut(window, target.context)?.binding = Some(control);
        Ok(binding)
    }

    pub fn promote_context(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        target: NativeMemoryContextTarget<'_>,
        prepared: NativeMemoryPreparedContext,
    ) -> Result<(), MemoryTrustError> {
        let owner = self.context_owner(window, target.context)?;
        if !Weak::ptr_eq(&target.context.identity, &prepared.target.identity)
            || owner.context.is_some()
            || owner.binding.is_none()
        {
            return Err(ReadError::Cancelled.into());
        }
        owner
            .binding
            .as_ref()
            .ok_or(ReadError::Cancelled)?
            .read_control()?;
        let context = self
            .selection_mut(window, target.presentation)?
            .promote_context(target.selected, prepared)?;
        let owner = self.context_owner_mut(window, target.context)?;
        owner.context = Some(context);
        owner.binding = None;
        Ok(())
    }

    fn context_owner(
        &self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
    ) -> Result<&ContextOwner, MemoryWorkError> {
        self.window(window)
            .and_then(|window| {
                window
                    .contexts
                    .iter()
                    .find(|owner| Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&owner.identity)))
            })
            .ok_or_else(|| ReadError::Cancelled.into())
    }

    fn context_owner_mut(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
    ) -> Result<&mut ContextOwner, MemoryWorkError> {
        self.window_mut(window)
            .and_then(|window| {
                window
                    .contexts
                    .iter_mut()
                    .find(|owner| Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&owner.identity)))
            })
            .ok_or_else(|| ReadError::Cancelled.into())
    }

    fn context(
        &self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
    ) -> Result<&super::super::context::NativeMemoryContext, MemoryWorkError> {
        self.context_owner(window, receipt)?
            .context
            .as_ref()
            .ok_or_else(|| ReadError::Cancelled.into())
    }

    pub fn is_context_current(
        &self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
    ) -> bool {
        self.context(window, receipt)
            .is_ok_and(|context| context.source.access.live.load(Ordering::Acquire))
    }

    pub fn context_root(
        &self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
    ) -> Result<PathBuf, MemoryWorkError> {
        Ok(self.context(window, receipt)?.native.root().to_owned())
    }

    pub fn session_context(
        &self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
        control: DiscoveryControl,
    ) -> Result<MemoryContextRead, MemoryTrustError> {
        self.context(window, receipt)?.read(control)
    }

    pub fn close_context(
        &mut self,
        window: &NativeMemoryWindowReceipt,
        receipt: &NativeMemoryContextReceipt,
    ) -> bool {
        let Some(window) = self.window_mut(window) else {
            return false;
        };
        let Some(index) = window
            .contexts
            .iter()
            .position(|owner| Weak::ptr_eq(&receipt.identity, &Arc::downgrade(&owner.identity)))
        else {
            return false;
        };
        window.contexts.swap_remove(index);
        true
    }
}
