# mftp-todo

共用待办模型、输入校验、SQLite 迁移、基础 CRUD、revision 校验和变更通知。数据库连接由 `Database` 端口提供；应用负责目录、连接策略和执行线程。

`schema::init` 在事务内初始化或升级待办表，保留备注、草稿和图片关系表，拒绝未知版本。富文本解析和图片处理由调用应用的备注服务负责。写操作在提交和释放连接后发出通知。

`list` 保留现有日期排序；`list_view` 提供原生未完成/已完成视图和稳定排序。`get` 返回任务及 revision，显式编辑、状态切换和删除可带预期 revision。

默认不依赖 UI 框架。`specta` 和 `schemars` 分别启用 IPC 和 JSON Schema 派生。从仓库根目录运行 `cargo test -p mftp-todo --locked`。
