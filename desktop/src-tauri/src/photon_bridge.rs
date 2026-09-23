use photon_engine::{projection::apply_operation, Operation, Record};

/// Mirror of Photon's own `photon_engine_apply_operation` command so the golf
/// desktop UI can persist durable course/hole records through the same engine.
#[tauri::command]
pub fn photon_engine_apply_operation(
    current: Option<Record>,
    operation: Operation,
) -> Result<Record, String> {
    apply_operation(current, &operation).map_err(|error| error.to_string())
}
