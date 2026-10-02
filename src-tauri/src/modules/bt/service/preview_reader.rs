//! Original-file IO uses tracked blocking workers, including reads after HTTP headers.

use super::workers::Worker;
use crate::error::AppResult;
use std::io::{Read, Seek};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt};

pub(super) trait ReadSeek: AsyncRead + AsyncSeek + Unpin + Send {}
impl<T: AsyncRead + AsyncSeek + Unpin + Send> ReadSeek for T {}

pub(super) enum Reader {
    File(Arc<parking_lot::Mutex<std::fs::File>>),
    Torrent(Box<dyn ReadSeek>),
}

impl Reader {
    pub(super) async fn open(path: PathBuf, worker: &Worker) -> AppResult<(Self, u64)> {
        worker
            .blocking(move || {
                let file = std::fs::File::open(path)?;
                let len = file.metadata()?.len();
                Ok((Self::File(Arc::new(parking_lot::Mutex::new(file))), len))
            })
            .await
    }

    pub(super) async fn seek(&mut self, offset: u64, worker: &Worker) -> AppResult<()> {
        let position = std::io::SeekFrom::Start(offset);
        match self {
            Self::File(file) => {
                let file = file.clone();
                worker
                    .blocking(move || Ok(file.lock().seek(position)?))
                    .await?;
            }
            Self::Torrent(reader) => {
                reader.seek(position).await?;
            }
        }
        Ok(())
    }

    pub(super) async fn read(
        &mut self,
        mut buffer: Vec<u8>,
        limit: usize,
        worker: &Worker,
    ) -> AppResult<(Vec<u8>, usize)> {
        match self {
            Self::File(file) => {
                let file = file.clone();
                // The buffer and file are owned by the real worker. Cancelling
                // its waiter cannot invalidate memory or release completion early.
                worker
                    .blocking(move || {
                        let count = file.lock().read(&mut buffer[..limit])?;
                        Ok((buffer, count))
                    })
                    .await
            }
            Self::Torrent(reader) => {
                let count = reader.read(&mut buffer[..limit]).await?;
                Ok((buffer, count))
            }
        }
    }
}

#[cfg(test)]
#[path = "preview_reader_tests.rs"]
mod tests;
