; Trace Player NSIS installer hooks.
;
; Registers the Windows Shell thumbnail provider (IThumbnailProvider) so
; Explorer renders the middle-frame thumbnail for video files associated
; with Trace Player, instead of falling back to the static app icon.
;
; All registry writes target HKCU because the bundle uses
; installMode: currentUser. Switching to perMachine would require HKLM
; and admin elevation.

!define SHELL_EXT_CLSID "{8B7C3A24-1E2F-4A8D-9B5C-DE2A1F8B7C30}"
!define ITHUMBNAILPROVIDER_GUID "{E357FCCD-A995-4576-B01F-234630154E96}"
!define SHELL_EXT_FRIENDLY_NAME "Trace Player Thumbnail Provider"
!define SHELL_EXT_DLL_RELPATH "bin\trace-player-shellext.dll"

!macro NSIS_HOOK_POSTINSTALL
    DetailPrint "Registering Trace Player thumbnail provider..."

    ; CLSID → DLL mapping. ThreadingModel=Apartment is required for
    ; in-process shell extensions per the IThumbnailProvider docs.
    WriteRegStr HKCU "Software\Classes\CLSID\${SHELL_EXT_CLSID}" "" "${SHELL_EXT_FRIENDLY_NAME}"
    WriteRegStr HKCU "Software\Classes\CLSID\${SHELL_EXT_CLSID}\InprocServer32" "" "$INSTDIR\${SHELL_EXT_DLL_RELPATH}"
    WriteRegStr HKCU "Software\Classes\CLSID\${SHELL_EXT_CLSID}\InprocServer32" "ThreadingModel" "Apartment"

    ; Hook the provider into every video extension Trace Player handles.
    ; The well-known IThumbnailProvider GUID is the "interface" key under
    ; ShellEx; the value is the CLSID of *our* provider.
    WriteRegStr HKCU "Software\Classes\.mp4\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.mkv\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.avi\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.mov\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.webm\ShellEx\${ITHUMBNAILPROVIDER_GUID}" "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.m4v\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.ts\ShellEx\${ITHUMBNAILPROVIDER_GUID}"   "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.flv\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"
    WriteRegStr HKCU "Software\Classes\.wmv\ShellEx\${ITHUMBNAILPROVIDER_GUID}"  "" "${SHELL_EXT_CLSID}"

    ; Tell Explorer the associations changed so it picks up the new provider
    ; without requiring a reboot. SHCNE_ASSOCCHANGED = 0x08000000.
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
    DetailPrint "Removing Trace Player thumbnail provider..."

    DeleteRegKey HKCU "Software\Classes\.mp4\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.mkv\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.avi\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.mov\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.webm\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.m4v\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.ts\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.flv\ShellEx\${ITHUMBNAILPROVIDER_GUID}"
    DeleteRegKey HKCU "Software\Classes\.wmv\ShellEx\${ITHUMBNAILPROVIDER_GUID}"

    DeleteRegKey HKCU "Software\Classes\CLSID\${SHELL_EXT_CLSID}"

    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
