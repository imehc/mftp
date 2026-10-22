use crate::core::diagnostics::Diagnostics;
use std::{
    future::Future,
    io,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Instant, Sleep},
};

pub(crate) struct Listener {
    inner: TcpListener,
    connections: Arc<Semaphore>,
    diagnostics: Arc<Diagnostics>,
}

impl Listener {
    pub(crate) fn new(inner: TcpListener, diagnostics: Arc<Diagnostics>) -> Self {
        Self {
            inner,
            connections: Arc::new(Semaphore::new(32)),
            diagnostics,
        }
    }
}

impl axum::serve::Listener for Listener {
    type Io = Connection;
    type Addr = SocketAddr;

    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.inner.local_addr()
    }

    async fn accept(&mut self) -> (Connection, SocketAddr) {
        loop {
            match self.inner.accept().await {
                Ok((stream, address)) => {
                    if let Ok(permit) = self.connections.clone().try_acquire_owned() {
                        return (
                            Connection {
                                stream,
                                _permit: permit,
                                idle: Box::pin(tokio::time::sleep(Duration::from_secs(30))),
                                deadline: Instant::now() + Duration::from_secs(120),
                            },
                            address,
                        );
                    }
                }
                Err(error) => {
                    if let Some(mut recorder) = self.diagnostics.begin("mcp", "accept", "127.0.0.1")
                    {
                        recorder.transport_error(&error);
                        recorder.finish(Some(&crate::error::AppError::custom(
                            crate::error::CustomErrorCode::McpTransport,
                        )));
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    }
}

pub(crate) struct Connection {
    stream: TcpStream,
    _permit: OwnedSemaphorePermit,
    idle: Pin<Box<Sleep>>,
    deadline: Instant,
}

impl Connection {
    fn check_timeout(&mut self, context: &mut Context<'_>) -> io::Result<()> {
        if self.idle.as_mut().poll(context).is_ready() || Instant::now() >= self.deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "MCP connection deadline exceeded",
            ));
        }
        Ok(())
    }

    fn touch(&mut self) {
        self.idle
            .as_mut()
            .reset((Instant::now() + Duration::from_secs(30)).min(self.deadline));
    }
}

impl AsyncRead for Connection {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.check_timeout(context)?;
        let before = buffer.filled().len();
        let result = Pin::new(&mut self.stream).poll_read(context, buffer);
        if buffer.filled().len() > before {
            self.touch();
        }
        result
    }
}

impl AsyncWrite for Connection {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.check_timeout(context)?;
        let result = Pin::new(&mut self.stream).poll_write(context, bytes);
        if matches!(result, Poll::Ready(Ok(length)) if length>0) {
            self.touch();
        }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(context)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(context)
    }
}
