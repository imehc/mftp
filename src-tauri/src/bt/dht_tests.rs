use super::{dht_state_for_counts, BtDhtState};

#[test]
fn dht_diagnostics_distinguish_bootstrap_and_ready_states() {
    assert!(matches!(
        dht_state_for_counts(0, 0, 0),
        BtDhtState::NotEstablished
    ));
    assert!(matches!(
        dht_state_for_counts(0, 0, 2),
        BtDhtState::Bootstrapping
    ));
    assert!(matches!(dht_state_for_counts(3, 0, 0), BtDhtState::Ready));
    assert!(matches!(dht_state_for_counts(0, 4, 1), BtDhtState::Ready));
}
