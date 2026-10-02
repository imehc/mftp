use super::*;
use std::io::Cursor;

#[test]
fn header_deadline_is_absolute_and_socket_timeout_is_restored() {
    use std::io::Write;
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (mut server, _) = listener.accept().unwrap();
    let previous = Some(Duration::from_secs(7));
    server.set_read_timeout(previous).unwrap();
    client.write_all(b"GET / HTTP/1.1\r\n\r\n").unwrap();
    assert!(read_from_stream(&mut server).unwrap().is_some());
    assert_eq!(server.read_timeout().unwrap(), previous);
    let mut reader = HeaderReader {
        stream: &mut server,
        deadline: Instant::now(),
    };
    assert_eq!(
        reader.read(&mut [0]).unwrap_err().kind(),
        io::ErrorKind::TimedOut
    );
    client.write_all(b"GET / HTTP/1.1\r\npartial").unwrap();
    client.shutdown(std::net::Shutdown::Write).unwrap();
    assert!(read_from_stream(&mut server).is_err());
    assert_eq!(server.read_timeout().unwrap(), previous);
}

struct Chunks {
    bytes: Cursor<Vec<u8>>,
    size: usize,
}
impl Read for Chunks {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let length = self.size.min(buffer.len());
        self.bytes.read(&mut buffer[..length])
    }
}

#[test]
fn segmented_headers_preserve_binary_body_and_never_parse_body_as_headers() {
    let head =
        b"POST /api/upload?name=test HTTP/1.1\r\nContent-Length: 4\r\nRange: bytes=0-1\r\n\r\n";
    let body = b"\xff\0\xfe\nCookie: token=forged\r\n";
    for size in [1, 2, 7, 1024] {
        let mut input = Chunks {
            bytes: Cursor::new([head.as_slice(), body].concat()),
            size,
        };
        let request = read_request(&mut input).unwrap().unwrap();
        assert_eq!(request.head.as_bytes(), head);
        let mut received = request.body;
        input.read_to_end(&mut received).unwrap();
        assert_eq!(received, body);
        assert!(unique_header(&request.head, "cookie").unwrap().is_none());
    }
}

#[test]
fn oversized_incomplete_and_malformed_headers_fail_without_a_request() {
    let large = format!(
        "GET / HTTP/1.1\r\nX-Large: {}\r\n\r\n",
        "x".repeat(MAX_HEADER_BYTES)
    );
    assert_eq!(
        read_request(&mut Cursor::new(large)).err().unwrap().code,
        "lan:request_headers_too_large"
    );
    for head in [
        "GET / HTTP/1.1\r\nCookie: partial",
        "GET / HTTP/1.1\r\nInvalid\r\n\r\n",
        "GET / HTTP/1.1\r\n Cookie: value\r\n\r\n",
        "GET / HTTP/1.1\r\nX: a\nb\r\n\r\n",
        "GET / HTTP/2\r\n\r\n",
    ] {
        assert_eq!(
            read_request(&mut Cursor::new(head)).err().unwrap().code,
            "lan:request_invalid",
            "{head}"
        );
    }
    assert!(read_request(&mut Cursor::new(b"")).unwrap().is_none());
}

#[test]
fn header_limit_does_not_count_the_first_body_bytes() {
    let prefix = "POST / HTTP/1.1\r\nX: ";
    let head = format!(
        "{prefix}{}\r\n\r\n",
        "a".repeat(MAX_HEADER_BYTES - prefix.len() - 4)
    );
    let request = read_request(&mut Cursor::new(format!("{head}body")))
        .unwrap()
        .unwrap();
    assert_eq!(request.head.len(), MAX_HEADER_BYTES);
    assert_eq!(
        unique_header(
            "POST / HTTP/1.1\r\nContent-Length: 1\r\ncontent-length: 1\r\n\r\n",
            "content-length"
        )
        .unwrap_err()
        .code,
        "lan:request_invalid"
    );
}
