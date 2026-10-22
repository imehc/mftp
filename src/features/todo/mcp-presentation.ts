import { msg } from "@lingui/core/macro";

export const todoMcpPresentation = {
  title: msg({
    message: "待办事项",
    comment: "MCP 工具目录和授权矩阵中的模块名称",
  }),
  tools: {
    todo_list: msg`查询待办列表`,
    todo_get: msg`读取完整图文`,
    todo_create: msg`新建文字待办`,
    todo_update: msg`修改待办信息`,
    todo_set_completed: msg`设置完成状态`,
    todo_set_abandoned: msg`设置放弃状态`,
    todo_delete: msg`删除待办及图片`,
    todo_note_draft_begin: msg`打开编辑草稿`,
    todo_note_draft_get: msg`读取编辑草稿`,
    todo_note_image_import: msg`导入图片`,
    todo_note_image_read: msg`读取图片`,
    todo_note_image_copy: msg`复制图片到草稿`,
    todo_note_image_discard: msg`移除草稿图片`,
    todo_note_save: msg`保存完整图文`,
    todo_note_save_status: msg`核实保存结果`,
    todo_note_draft_close: msg`关闭编辑草稿`,
  },
};
