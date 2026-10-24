Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoDir = fso.GetParentFolderName(scriptDir)
vbsPath = fso.BuildPath(scriptDir, "auto-sync.vbs")

Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.ExpandEnvironmentStrings("%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ESB-Banner-Studio-AutoSync.lnk")
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "wscript.exe"
oLink.Arguments = """" & vbsPath & """"
oLink.WorkingDirectory = repoDir
oLink.WindowStyle = 7
oLink.Description = "ESB Banner Studio Auto-Sync Daemon"
oLink.Save
