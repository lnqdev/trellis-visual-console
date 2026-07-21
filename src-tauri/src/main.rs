#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 启动 Trellis Visual Console 桌面进程。
fn main() {
    trellis_visual_console_lib::run();
}
