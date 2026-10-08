// 保留应用启动和设置页的调用入口；任务状态与交互由 updater 功能管理。
export {
  checkForUpdateManually,
  checkForUpdateOnLaunch,
  restartToApplyUpdate,
} from "~/features/updater/controller";
