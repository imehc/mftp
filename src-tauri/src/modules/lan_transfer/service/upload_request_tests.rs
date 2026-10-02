use super::*;

fn parse(fields: &str) -> AppResult<UploadRequest> {
    UploadRequest::parse(&format!(
        "POST /api/upload?name=folder%2Ffile&conflict=resume HTTP/1.1\r\n{fields}\r\n"
    ))
}

#[test]
fn validates_empty_whole_and_partial_bodies() {
    let empty = parse("Content-Length: 0\r\n").unwrap();
    assert_eq!((empty.start, empty.length), (0, 0));
    let partial =
        parse("content-length: 3\r\nContent-Range: bytes 2-4/10\r\nX-Mftp-Total-Size: 10\r\n")
            .unwrap();
    assert_eq!((partial.start, partial.length), (2, 3));
    assert_eq!(partial.relative, Path::new("folder/file"));
    assert_eq!(partial.conflict, Conflict::Resume);
    assert_eq!(
        parse("Content-Length: 18446744073709551615\r\n")
            .unwrap()
            .length,
        u64::MAX
    );
}

#[test]
fn rejects_ambiguous_or_inconsistent_framing() {
    for fields in [
        "",
        "Content-Length: +1\r\n",
        "Content-Length: -1\r\n",
        "Content-Length: 18446744073709551616\r\n",
        "Content-Length: 1\r\ncontent-length: 1\r\n",
        "Content-Length: 1\r\nTransfer-Encoding: chunked\r\n",
        "Content-Length: 1\r\nExpect: 100-continue\r\n",
        "Content-Length: 1\r\nContent-Range: bad\r\n",
        "Content-Length: 2\r\nContent-Range: bytes 0-2/5\r\n",
        "Content-Length: 2\r\nContent-Range: bytes 3-2/5\r\n",
        "Content-Length: 1\r\nContent-Range: bytes 0-0/*\r\n",
        "Content-Length: 2\r\nContent-Range: bytes 0-1/1\r\n",
        "Content-Length: 2\r\nContent-Range: bytes 0-1/3\r\ncontent-range: bytes 0-1/3\r\n",
        "Content-Length: 2\r\nX-Mftp-Total-Size: 3\r\n",
    ] {
        assert!(parse(fields).is_err(), "{fields}");
    }
}

#[test]
fn paths_are_decoded_without_utf8_slicing_and_traversal_is_rejected() {
    for name in [
        "../outside",
        "%2Foutside",
        "folder%2F..%2Foutside",
        "%00bad",
        "",
        ".",
    ] {
        assert!(
            relative_name(&format!("POST /api/upload?name={name} HTTP/1.1")).is_err(),
            "{name}"
        );
    }
    for name in ["%中.txt", "folder%2F%E6%96%87%E4%BB%B6.txt"] {
        assert!(relative_name(&format!("POST /api/upload?name={name} HTTP/1.1")).is_ok());
    }
    for conflict in ["overwrite", "rename", "unknown"] {
        assert!(UploadRequest::parse(&format!("POST /api/upload?name=file&conflict={conflict} HTTP/1.1\r\nContent-Length: 2\r\nContent-Range: bytes 2-3/4\r\n\r\n")).is_err());
    }
}
