//! Compile-time proof that the shift update and delete calls PLT-3835 added are
//! reachable from this repository.
//!
//! The gateway that will use them is not written yet — it waits on the
//! ownership check in tachyonfield#1149 and on the production measurement in
//! PLT-3916. Until then this file is what keeps the sdk bump honest: bumping a
//! rev proves nothing on its own, and `cargo check` is happy with a dependency
//! whose surface never grew.
//!
//! Delete this once a real gateway calls the same functions.

use field_sdk::apis::hrm_api;
use field_sdk::models::UpdateStaffShiftRequest;

#[allow(dead_code)]
fn shift_update_is_reachable(request: UpdateStaffShiftRequest) -> UpdateStaffShiftRequest {
    // `staffId` and `date` are absent by design: changing either is a DELETE
    // followed by a new POST, so the nested resource keeps its identity.
    UpdateStaffShiftRequest {
        start_time: request.start_time,
        end_time: request.end_time,
        shift_type: request.shift_type,
        notes: request.notes,
    }
}

#[allow(dead_code)]
fn calls_exist() {
    // Referenced, never invoked: taking the function items is enough to fail
    // the build if either endpoint disappears from the generated client.
    let _update = hrm_api::update_staff_shift;
    let _delete = hrm_api::delete_staff_shift;
}

fn main() {}
