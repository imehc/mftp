use std::io;
use std::net::{Shutdown, TcpStream};
use std::thread::{self, JoinHandle};

struct Connection {
    socket: TcpStream,
    worker: JoinHandle<()>,
}

/// Owned by one listener generation; completed handles are reaped during accept.
#[derive(Default)]
pub(crate) struct Connections {
    active: Vec<Connection>,
}

impl Connections {
    pub(crate) fn spawn(
        &mut self,
        stream: TcpStream,
        handle: impl FnOnce(TcpStream) + Send + 'static,
    ) -> io::Result<()> {
        // Accepted sockets can inherit the listener's nonblocking mode on BSD.
        // Each dedicated worker relies on blocking IO and explicit shutdown.
        stream.set_nonblocking(false)?;
        // Cloning before spawn means failure cannot leave an untracked worker.
        let socket = stream.try_clone()?;
        let worker = thread::Builder::new()
            .name("tcp-connection".into())
            .spawn(move || handle(stream))?;
        self.active.push(Connection { socket, worker });
        Ok(())
    }

    pub(crate) fn len(&self) -> usize {
        self.active.len()
    }

    pub(crate) fn reap(&mut self) {
        let mut index = 0;
        while index < self.active.len() {
            if self.active[index].worker.is_finished() {
                let connection = self.active.swap_remove(index);
                let _ = connection.worker.join();
            } else {
                index += 1;
            }
        }
    }
}

impl Drop for Connections {
    fn drop(&mut self) {
        // Wake blocked reads/writes on every connection before joining any one.
        // Socket shutdown does not interrupt disk IO: join remains the barrier
        // for file handles, transfer permits, and trailing database writes.
        for connection in &self.active {
            let _ = connection.socket.shutdown(Shutdown::Both);
        }
        for connection in self.active.drain(..) {
            let _ = connection.worker.join();
        }
    }
}

#[cfg(test)]
#[path = "connections_tests.rs"]
mod tests;
