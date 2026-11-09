; electron-builder 가 NSIS 설치 프로그램에 끼워 넣는 스크립트(build/installer.nsh).
; 앱을 지울 때 "로그인할 때 실행" 등록도 지운다. Electron 은 AppUserModelId(appId)를 값 이름으로 쓴다.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.github.yeonjin1357.pitwall"
!macroend
