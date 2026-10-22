use std::{collections::BTreeMap, future::Future, pin::Pin, sync::Arc};

use rmcp::{
    handler::server::common::{schema_for_input, schema_for_output},
    model::{CallToolResult, Tool, ToolAnnotations},
    schemars::JsonSchema,
    ErrorData,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

use super::access::{Caller, Permission};
use super::model::{McpModuleInfo, McpPermission, McpToolInfo};
use crate::error::{AppError, AppResult, CustomErrorCode};

type ToolFuture = Pin<Box<dyn Future<Output = Result<CallToolResult, ErrorData>> + Send>>;
type Handler = Arc<dyn Fn(Caller, Value) -> ToolFuture + Send + Sync>;

pub(crate) struct RegisteredTool {
    pub(crate) description: Tool,
    permission: Permission,
    handler: Handler,
}

pub(crate) struct ModuleRegistration {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
    pub(crate) tools: Vec<RegisteredTool>,
    pub(crate) lifecycle: Option<Arc<dyn ModuleLifecycle>>,
}

pub(crate) trait ModuleLifecycle: Send + Sync {
    fn close_subject(&self, subject: &str) -> AppResult<()>;
    fn shutdown(&self) -> AppResult<()>;
    fn busy(&self) -> AppResult<bool>;
    fn reopen(&self) -> AppResult<()> {
        Ok(())
    }
}

pub(crate) struct Registry {
    modules: BTreeMap<&'static str, ModuleRegistration>,
    tools: BTreeMap<String, (&'static str, usize)>,
}

pub(crate) fn registration_error(message: impl Into<String>) -> AppError {
    AppError::custom(CustomErrorCode::McpRegistrationInvalid).context(message.into())
}

pub(crate) fn tool<I, O, F, Fut>(
    name: &'static str,
    description: &'static str,
    permission: Permission,
    operation: F,
) -> AppResult<RegisteredTool>
where
    I: DeserializeOwned + JsonSchema + Send + 'static,
    O: Serialize + JsonSchema + Send + 'static,
    F: Fn(Caller, I) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = AppResult<O>> + Send + 'static,
{
    content_tool(name, description, permission, operation, |output| {
        serde_json::to_value(output)
            .map(CallToolResult::structured)
            .map_err(AppError::from)
    })
}

pub(crate) fn content_tool<I, O, F, Fut, C>(
    name: &'static str,
    description: &'static str,
    permission: Permission,
    operation: F,
    render: C,
) -> AppResult<RegisteredTool>
where
    I: DeserializeOwned + JsonSchema + Send + 'static,
    O: Serialize + JsonSchema + Send + 'static,
    F: Fn(Caller, I) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = AppResult<O>> + Send + 'static,
    C: Fn(O) -> AppResult<CallToolResult> + Send + Sync + 'static,
{
    let mut metadata = Tool::new(
        name,
        description,
        schema_for_input::<I>().map_err(registration_error)?,
    );
    metadata.output_schema = Some(schema_for_output::<O>());
    let mut annotations = ToolAnnotations::default();
    annotations.read_only_hint = Some(permission == Permission::Read);
    annotations.destructive_hint = Some(permission != Permission::Read);
    annotations.open_world_hint = Some(false);
    metadata.annotations = Some(annotations);
    let operation = Arc::new(operation);
    let render = Arc::new(render);
    Ok(RegisteredTool {
        description: metadata,
        permission,
        handler: Arc::new(move |caller, value| {
            let operation = operation.clone();
            let render = render.clone();
            Box::pin(async move {
                let input = serde_json::from_value(value)
                    .map_err(|error| ErrorData::invalid_params(error.to_string(), None))?;
                match operation(caller, input)
                    .await
                    .and_then(|output| render(output))
                {
                    Ok(result) => Ok(result),
                    Err(error) => Ok(CallToolResult::structured_error(
                        serde_json::json!({ "error": error }),
                    )),
                }
            })
        }),
    })
}

impl Registry {
    pub(crate) fn reopen(&self) -> AppResult<()> {
        for module in self.modules.values() {
            if let Some(lifecycle) = &module.lifecycle {
                lifecycle.reopen()?;
            }
        }
        Ok(())
    }
    pub(crate) fn catalog(&self) -> Vec<McpModuleInfo> {
        self.modules
            .values()
            .map(|module| McpModuleInfo {
                id: module.id.into(),
                title: module.title.into(),
                tools: module
                    .tools
                    .iter()
                    .map(|tool| McpToolInfo {
                        name: tool.description.name.to_string(),
                        description: tool
                            .description
                            .description
                            .as_deref()
                            .unwrap_or_default()
                            .into(),
                        permission: match tool.permission {
                            Permission::Read => McpPermission::Read,
                            Permission::Write => McpPermission::Write,
                            Permission::Delete => McpPermission::Delete,
                        },
                    })
                    .collect(),
            })
            .collect()
    }

    pub(crate) fn close_subject(&self, subject: &str) -> AppResult<()> {
        let mut failure = None;
        for module in self.modules.values() {
            if let Some(lifecycle) = &module.lifecycle {
                if let Err(error) = lifecycle.close_subject(subject) {
                    failure = Some(error);
                }
            }
        }
        failure.map_or(Ok(()), Err)
    }

    pub(crate) fn shutdown(&self) -> AppResult<()> {
        let mut failure = None;
        for module in self.modules.values() {
            if let Some(lifecycle) = &module.lifecycle {
                if let Err(error) = lifecycle.shutdown() {
                    failure = Some(error);
                }
            }
        }
        failure.map_or(Ok(()), Err)
    }

    pub(crate) fn busy(&self) -> AppResult<bool> {
        for module in self.modules.values() {
            if let Some(lifecycle) = &module.lifecycle {
                if lifecycle.busy()? {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    pub(crate) fn new(registrations: Vec<ModuleRegistration>) -> AppResult<Self> {
        let mut modules = BTreeMap::new();
        let mut tools = BTreeMap::new();
        for module in registrations {
            if module.id.is_empty()
                || !module
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
                || module.title.is_empty()
                || modules.contains_key(module.id)
            {
                return Err(registration_error("Duplicate or empty MCP module identity"));
            }
            if module.tools.is_empty() {
                return Err(registration_error("MCP module has no tools"));
            }
            for (index, tool) in module.tools.iter().enumerate() {
                let name = tool.description.name.to_string();
                if name.len() > 128
                    || name.len() <= module.id.len() + 1
                    || !name.starts_with(&format!("{}_", module.id))
                    || !name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                    || tools.insert(name, (module.id, index)).is_some()
                {
                    return Err(registration_error("Invalid or duplicate MCP tool name"));
                }
                if tool
                    .description
                    .description
                    .as_ref()
                    .is_none_or(|description| description.trim().is_empty())
                    || tool.description.input_schema.get("type")
                        != Some(&serde_json::json!("object"))
                {
                    return Err(registration_error(
                        "MCP tools require a description and object input schema",
                    ));
                }
            }
            modules.insert(module.id, module);
        }
        Ok(Self { modules, tools })
    }

    pub(crate) fn list(&self, caller: &Caller) -> Vec<Tool> {
        self.tools
            .values()
            .filter_map(|(module, index)| {
                let tool = &self.modules[module].tools[*index];
                caller
                    .allows(module, tool.permission)
                    .then(|| tool.description.clone())
            })
            .collect()
    }

    pub(crate) async fn call(
        &self,
        caller: Caller,
        name: &str,
        arguments: Value,
    ) -> Result<CallToolResult, ErrorData> {
        let (module, index) = self
            .tools
            .get(name)
            .ok_or_else(|| ErrorData::invalid_params("Unknown or unavailable MCP tool", None))?;
        let tool = &self.modules[module].tools[*index];
        if !caller.allows(module, tool.permission) {
            return Err(ErrorData::invalid_params(
                "Unknown or unavailable MCP tool",
                None,
            ));
        }
        let result = (tool.handler)(caller, arguments).await?;
        let encoded = serde_json::to_vec(&result)
            .map_err(|_| ErrorData::internal_error("MCP result serialization failed", None))?;
        if encoded.len() > 2 * 1024 * 1024 {
            return Err(ErrorData::internal_error(
                "MCP result exceeds the complete response limit; no editable content was returned",
                None,
            ));
        }
        Ok(result)
    }
}
