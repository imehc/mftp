use std::path::Path;
use std::time::Duration;

use super::{dht_config, BT_DHT_DUMP_INTERVAL, BT_INIT_CONCURRENCY, BT_PEER_LIMIT};

#[test]
fn dht_state_is_persisted_inside_bt_data_directory() {
    let base = Path::new("/platform/app-data/bt");
    let config = dht_config(base);
    let persistence = config.persistence.expect("BT enables DHT persistence");

    assert_eq!(persistence.config_filename, Some(base.join("dht.json")));
    assert_eq!(persistence.dump_interval, Some(BT_DHT_DUMP_INTERVAL));
}

#[test]
fn session_limits_are_explicit_and_bounded() {
    assert_eq!(BT_INIT_CONCURRENCY, 2);
    assert_eq!(BT_PEER_LIMIT, 64);
    assert_eq!(BT_DHT_DUMP_INTERVAL, Duration::from_secs(60));
}
