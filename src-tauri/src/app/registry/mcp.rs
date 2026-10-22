use std::sync::Arc;

use crate::{
    error::AppResult,
    modules::{
        mcp::registry::Registry,
        todo::mcp::{self, TodoContext},
    },
};

pub(crate) fn build(todo: Arc<TodoContext>) -> AppResult<Registry> {
    Registry::new(vec![mcp::registration(todo)?])
}
