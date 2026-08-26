; "Open in Voktty" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInVoktty" "" "Open in Voktty"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInVoktty" "Icon" '"$INSTDIR\voktty.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInVoktty" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInVoktty\command" "" '"$INSTDIR\voktty.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInVoktty" "" "Open in Voktty"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInVoktty" "Icon" '"$INSTDIR\voktty.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInVoktty" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInVoktty\command" "" '"$INSTDIR\voktty.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInVoktty" "" "Open in Voktty"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInVoktty" "Icon" '"$INSTDIR\voktty.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInVoktty" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInVoktty\command" "" '"$INSTDIR\voktty.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Voktty Document\DefaultIcon" "" '"$INSTDIR\icons\document.ico",0'
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInVoktty"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInVoktty"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInVoktty"
!macroend
