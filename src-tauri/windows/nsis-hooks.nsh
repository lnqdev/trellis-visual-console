!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否删除 Trellis Visual Console 的本地项目列表、快照和日志？已登记的 Trellis 项目不会被删除。" IDNO keep_application_data
  RMDir /r "$APPDATA\Trellis Visual Console"
  keep_application_data:
!macroend
