use super::*;
#[test]
fn inbox_is_bounded_and_drains_without_replaying() {
    let inbox = ModelOpenInbox::default();
    for i in 0..9 {
        inbox.push(format!("/model-{i}.glb"));
    }
    let (items, failed) = inbox.drain();
    assert_eq!(items.len(), 8);
    assert!(failed);
    assert_eq!(inbox.drain(), (vec![], false));
}
#[test]
fn requests_reject_remote_urls_and_preserve_encoded_file_names() {
    assert!(local_request("https://example.com/model.glb".into()).is_none());
    assert!(local_request("relative.glb".into()).is_none());
    assert!(local_request("/tmp/a.html".into()).is_none());
    let request = local_request("file:///tmp/a%20b.GLB".into()).unwrap();
    assert_eq!(request.name, "a b.GLB");
    assert!(request.path.ends_with("a b.GLB"));
}
