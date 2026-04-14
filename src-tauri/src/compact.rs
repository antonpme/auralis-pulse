use std::process::Command;

/// Trigger /compact in a Claude Code CLI session.
/// Strategy: use PowerShell to find the terminal window and send keystrokes.
pub fn trigger_compact(pid: u32) -> Result<String, String> {
    // Use PowerShell to send keystrokes to the process's console window
    let ps_script = format!(
        r#"
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {{
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
            [DllImport("user32.dll")]
            public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
            [DllImport("user32.dll")]
            public static extern bool IsWindowVisible(IntPtr hWnd);
        }}
"@

        $targetPid = {pid}
        $found = $false

        # Find console host process (conhost.exe) that's the parent/child of our PID
        # Or find the terminal window directly
        $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if (-not $proc) {{
            Write-Error "Process $targetPid not found"
            exit 1
        }}

        # Try to find the window associated with the process tree
        # Claude Code runs under node.exe, which is under a terminal (Windows Terminal, cmd, etc.)
        $parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" -ErrorAction SilentlyContinue).ParentProcessId

        # Try parent's parent (terminal -> shell -> node)
        if ($parentPid) {{
            $grandParentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$parentPid" -ErrorAction SilentlyContinue).ParentProcessId
        }}

        # Try to find any visible window in the process tree
        foreach ($checkPid in @($targetPid, $parentPid, $grandParentPid)) {{
            if (-not $checkPid) {{ continue }}
            $checkProc = Get-Process -Id $checkPid -ErrorAction SilentlyContinue
            if ($checkProc -and $checkProc.MainWindowHandle -ne [IntPtr]::Zero) {{
                [Win32]::ShowWindow($checkProc.MainWindowHandle, 9) # SW_RESTORE
                [Win32]::SetForegroundWindow($checkProc.MainWindowHandle)
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("/compact{{ENTER}}")
                $found = $true
                break
            }}
        }}

        if (-not $found) {{
            Write-Output "FALLBACK"
        }} else {{
            Write-Output "OK"
        }}
        "#
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout == "OK" {
        Ok("Compact triggered successfully".to_string())
    } else if stdout == "FALLBACK" {
        Err("Could not find terminal window. Try opening it manually.".to_string())
    } else if !stderr.is_empty() {
        Err(format!("Error: {}", stderr))
    } else {
        Err("Unknown error triggering compact".to_string())
    }
}
