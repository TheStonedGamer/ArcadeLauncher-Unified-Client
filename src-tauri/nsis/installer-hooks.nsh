; NSIS installer hooks for the Steam-style boot flow.
;
; The bootstrap updater (updater.exe) is bundled as a sidecar and installed next
; to the launcher in $INSTDIR. We want it — not the launcher — to be what the
; user's shortcuts launch, so it can check for and apply updates before handing
; off to the app. Tauri's NSIS template creates the Start Menu / desktop
; shortcuts pointing at the main binary; this POSTINSTALL hook runs afterward and
; re-points them at updater.exe.
;
; Only POSTINSTALL is defined — Tauri supplies empty defaults for the other hooks.

!macro NSIS_HOOK_POSTINSTALL
  ; Start Menu shortcut is always created for a per-user install.
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\updater.exe"

  ; Re-point the desktop shortcut only if the user chose to create one.
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\updater.exe"
!macroend
