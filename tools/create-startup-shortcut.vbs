Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.ExpandEnvironmentStrings("%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ESB-Banner-Studio-AutoSync.lnk")
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "wscript.exe"
oLink.Arguments = """C:\Users\User\esb-banner-studio\tools\auto-sync.vbs"""
oLink.WorkingDirectory = "C:\Users\User\esb-banner-studio"
oLink.WindowStyle = 7
oLink.Description = "ESB Banner Studio Auto-Sync Daemon"
oLink.Save
