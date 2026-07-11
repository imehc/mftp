impl Manager {
    pub fn cancel_all_transfers(&self) {
        let flags: Vec<Arc<TransferFlag>> = self.transfers.lock().values().cloned().collect();
        for flag in flags {
            let mut control = flag.control.lock();
            control.cancelled = true;
            control.paused = false;
            flag.control_changed.notify_all();
        }
    }

    pub fn cancel_transfer(&self, transfer_id: &str) {
        let mut transfers = self.transfers.lock();
        let flag = transfers
            .entry(transfer_id.to_string())
            .or_insert_with(|| Arc::new(TransferFlag::new(true, false)));
        let mut control = flag.control.lock();
        control.cancelled = true;
        control.paused = false;
        flag.control_changed.notify_all();
    }

    pub fn pause_transfer(&self, transfer_id: &str) -> AppResult<()> {
        let transfers = self.transfers.lock();
        let Some(flag) = transfers.get(transfer_id) else {
            return Err(AppError("传输任务尚未开始或已结束".into()));
        };
        let mut control = flag.control.lock();
        if !control.pausable {
            return Err(AppError("当前传输阶段无法暂停".into()));
        }
        if control.cancelled {
            return Err(AppError("传输已取消".into()));
        }
        control.paused = true;
        Ok(())
    }

    pub fn resume_transfer(&self, transfer_id: &str) -> AppResult<()> {
        let transfers = self.transfers.lock();
        let Some(flag) = transfers.get(transfer_id) else {
            return Err(AppError("传输任务已结束".into()));
        };
        let mut control = flag.control.lock();
        if control.cancelled {
            return Err(AppError("传输已取消".into()));
        }
        control.paused = false;
        flag.control_changed.notify_all();
        Ok(())
    }

    fn transfer_guard(&self, transfer_id: Option<&str>) -> Option<TransferGuard> {
        let id = transfer_id?.to_string();
        let mut transfers = self.transfers.lock();
        let flag = transfers
            .entry(id.clone())
            .or_insert_with(|| Arc::new(TransferFlag::new(false, false)))
            .clone();
        flag.refs.fetch_add(1, Ordering::SeqCst);
        Some(TransferGuard {
            id,
            flag,
            transfers: self.transfers.clone(),
        })
    }
}
