use std::process::Command;

/// Try to send text to a process's console via WriteConsoleInput.
/// Bypasses focus/SendKeys entirely - writes directly to the console input buffer.
/// Works even if the target window is not focused or is behind other windows.
///
/// Returns Ok(msg) on success, Err(msg) if AttachConsole or WriteConsoleInput failed.
#[cfg(windows)]
fn send_via_console(pid: u32, text: &str) -> Result<String, String> {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::System::Console::{
        AttachConsole, FreeConsole, GetStdHandle, WriteConsoleInputW, INPUT_RECORD,
        INPUT_RECORD_0, KEY_EVENT_RECORD, KEY_EVENT_RECORD_0, STD_INPUT_HANDLE,
    };

    const KEY_EVENT: u16 = 0x0001;
    const VK_RETURN: u16 = 0x0D;

    // Trim trailing whitespace/newlines so we don't end the paste on a blank line.
    let text = text.trim_end_matches(|c: char| c == '\n' || c == '\r' || c == ' ' || c == '\t');

    // For multi-line text, wrap in bracketed paste markers (ESC[200~ ... ESC[201~)
    // so the TUI receives it as a single paste event, not as individual keystrokes.
    // Single-line text is sent as plain chars.
    let has_newlines = text.contains('\n');

    // Helper to push a Key-down + Key-up pair for a given char or virtual key.
    fn push_key_pair(
        records: &mut Vec<INPUT_RECORD>,
        unicode_char: u16,
        vk_code: u16,
        ctrl_state: u32,
    ) {
        for &down in &[true, false] {
            records.push(INPUT_RECORD {
                EventType: KEY_EVENT,
                Event: INPUT_RECORD_0 {
                    KeyEvent: KEY_EVENT_RECORD {
                        bKeyDown: BOOL(if down { 1 } else { 0 }),
                        wRepeatCount: 1,
                        wVirtualKeyCode: vk_code,
                        wVirtualScanCode: 0,
                        uChar: KEY_EVENT_RECORD_0 {
                            UnicodeChar: unicode_char,
                        },
                        dwControlKeyState: ctrl_state,
                    },
                },
            });
        }
    }

    // Helper to emit a string as char-level key events (used for paste markers + content)
    fn emit_string(records: &mut Vec<INPUT_RECORD>, s: &str) {
        for c in s.chars() {
            if c == '\r' {
                continue; // Skip CR; LF is emitted as plain char inside bracketed paste
            }
            let mut units = [0u16; 2];
            let encoded = c.encode_utf16(&mut units);
            for &unit in encoded.iter() {
                push_key_pair(records, unit, 0, 0);
            }
        }
    }

    // Content records (Ctrl+U clear + text + optional paste markers) - NO final Enter yet
    let mut content_records: Vec<INPUT_RECORD> = Vec::new();

    // Ctrl+U: clear any existing text in the target's input line before paste.
    // VK_U=0x55, Unicode 0x15 (NAK char that Ctrl+U produces in terminals).
    // This prevents accumulation of leftover text if previous sends sat in input.
    const VK_U: u16 = 0x55;
    const LEFT_CTRL_PRESSED: u32 = 0x0008;
    push_key_pair(&mut content_records, 0x15, VK_U, LEFT_CTRL_PRESSED);

    if has_newlines {
        // Bracketed paste: ESC[200~ <content> ESC[201~
        emit_string(&mut content_records, "\x1b[200~");
        emit_string(&mut content_records, text);
        emit_string(&mut content_records, "\x1b[201~");
    } else {
        emit_string(&mut content_records, text);
    }

    // Enter records - sent in a SEPARATE WriteConsoleInput call after a delay,
    // so the TUI's async paste handler has time to process content before Enter arrives.
    let mut enter_records: Vec<INPUT_RECORD> = Vec::new();
    push_key_pair(&mut enter_records, 0x0D, VK_RETURN, 0);

    unsafe {
        let _ = FreeConsole();

        if let Err(e) = AttachConsole(pid) {
            return Err(format!("AttachConsole({}) failed: {:?}", pid, e));
        }

        let h_in = match GetStdHandle(STD_INPUT_HANDLE) {
            Ok(h) if !h.is_invalid() => h,
            Ok(_) => {
                let _ = FreeConsole();
                return Err("GetStdHandle returned invalid handle".to_string());
            }
            Err(e) => {
                let _ = FreeConsole();
                return Err(format!("GetStdHandle failed: {:?}", e));
            }
        };

        // Phase 1: content (paste block or plain chars)
        let mut written_content: u32 = 0;
        let content_result = WriteConsoleInputW(h_in, &content_records, &mut written_content);
        if let Err(e) = content_result {
            let _ = FreeConsole();
            return Err(format!("WriteConsoleInput(content) failed: {:?}", e));
        }

        // Pause so ink/ConPTY fully commits the paste/chars before Enter arrives.
        // Multi-line needs more time because bracketed paste end-marker processing
        // is async. Single-line can use shorter delay (but 150ms still fine UX-wise).
        let delay_ms = if has_newlines { 250 } else { 100 };
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));

        // Phase 2: final Enter
        let mut written_enter: u32 = 0;
        let enter_result = WriteConsoleInputW(h_in, &enter_records, &mut written_enter);

        let _ = FreeConsole();

        match enter_result {
            Ok(_) => Ok(format!(
                "WriteConsoleInput: content {}/{} + enter {}/{} (delay {}ms) to PID {}",
                written_content,
                content_records.len(),
                written_enter,
                enter_records.len(),
                delay_ms,
                pid
            )),
            Err(e) => Err(format!("WriteConsoleInput(enter) failed: {:?}", e)),
        }
    }
}

#[cfg(not(windows))]
fn send_via_console(_pid: u32, _text: &str) -> Result<String, String> {
    Err("Console input only supported on Windows".to_string())
}

/// Escape text so it's sent literally via SendKeys (not interpreted as modifier keys).
/// SendKeys special chars: + ^ % ~ ( ) [ ] { }
/// Newlines become Shift+Enter (soft newline in Claude Code input).
fn escape_for_sendkeys(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for c in text.chars() {
        match c {
            '+' | '^' | '%' | '~' | '(' | ')' | '[' | ']' | '{' | '}' => {
                out.push('{');
                out.push(c);
                out.push('}');
            }
            '\n' => out.push_str("+{ENTER}"), // Shift+Enter soft newline
            '\r' => {} // skip CR (Windows CRLF)
            _ => out.push(c),
        }
    }
    out
}

/// Escape a string for use inside a PowerShell single-quoted string literal.
/// Single-quoted PS strings are literal (no expansion) except for '' which becomes '.
fn escape_for_ps_single_quote(s: &str) -> String {
    s.replace('\'', "''")
}

/// Send arbitrary text to the terminal hosting the process with the given PID.
/// Tries WriteConsoleInput first (writes directly to console input buffer, bypasses focus
/// and modern Windows input filters used by WT/ConPTY). Falls back to SwitchToThisWindow +
/// SendKeys if the console path fails (e.g., for non-console processes).
pub fn send_command(pid: u32, text: &str) -> Result<String, String> {
    // --- Path 1: WriteConsoleInput via AttachConsole ---
    // This writes directly into the target process's console input buffer.
    // Works regardless of focus, window ordering, or whether WT is using ConPTY.
    match send_via_console(pid, text) {
        Ok(msg) => {
            return Ok(format!("console path: {}", msg));
        }
        Err(console_err) => {
            eprintln!(
                "[Pulse] console path failed for pid={}: {}. Falling back to SendKeys.",
                pid, console_err
            );
            // Continue to SendKeys fallback below
        }
    }

    // --- Path 2: SwitchToThisWindow + SendKeys (fallback) ---
    send_via_sendkeys(pid, text).map(|msg| format!("sendkeys path: {}", msg))
}

fn send_via_sendkeys(pid: u32, text: &str) -> Result<String, String> {
    let escaped_keys = escape_for_sendkeys(text);
    let escaped_ps = escape_for_ps_single_quote(&escaped_keys);

    let ps_script = format!(
        r#"
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {{
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
            [DllImport("user32.dll")]
            public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern int GetWindowTextLength(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
            public static string GetWindowTitle(IntPtr hWnd) {{
                int len = GetWindowTextLength(hWnd);
                if (len == 0) return "";
                var sb = new System.Text.StringBuilder(len + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                return sb.ToString();
            }}
        }}
"@

        $targetPid = {pid}
        $pids = @($targetPid)
        $currentPid = $targetPid
        # Walk up to 6 levels (covers Windows Terminal deep hierarchy)
        for ($i = 0; $i -lt 6; $i++) {{
            $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -ErrorAction SilentlyContinue).ParentProcessId
            if (-not $parent -or $parent -eq 0 -or $parent -eq 4) {{ break }}
            $pids += $parent
            $currentPid = $parent
        }}

        Write-Output "DIAG pid_chain: $($pids -join ' -> ')"

        $found = $false
        $selectedPid = $null
        $selectedHwnd = $null
        $selectedName = $null
        $selectedTitle = $null

        foreach ($checkPid in $pids) {{
            $checkProc = Get-Process -Id $checkPid -ErrorAction SilentlyContinue
            if (-not $checkProc) {{
                Write-Output "DIAG pid=$checkPid not_found"
                continue
            }}
            $hwnd = $checkProc.MainWindowHandle
            $title = if ($hwnd -ne [IntPtr]::Zero) {{ [Win32]::GetWindowTitle($hwnd) }} else {{ "" }}
            Write-Output "DIAG pid=$checkPid name=$($checkProc.ProcessName) hwnd=$hwnd title='$title'"
            if ($hwnd -ne [IntPtr]::Zero -and -not $found) {{
                $selectedPid = $checkPid
                $selectedHwnd = $hwnd
                $selectedName = $checkProc.ProcessName
                $selectedTitle = $title
                $found = $true
            }}
        }}

        if ($found) {{
            Write-Output "DIAG selected: pid=$selectedPid name=$selectedName hwnd=$selectedHwnd title='$selectedTitle'"
            [Win32]::ShowWindow($selectedHwnd, 9) | Out-Null
            [Win32]::SwitchToThisWindow($selectedHwnd, $true)
            Start-Sleep -Milliseconds 400
            $curFg = [Win32]::GetForegroundWindow()
            $curFgTitle = [Win32]::GetWindowTitle($curFg)
            Write-Output "DIAG after_switch: current_fg_hwnd=$curFg title='$curFgTitle'"
            if ($curFg -ne $selectedHwnd) {{
                Write-Output "DIAG warn: foreground did not switch to target (still '$curFgTitle')"
            }}
            [System.Windows.Forms.SendKeys]::SendWait('{text}' + '{{ENTER}}')
            Write-Output "DIAG sendkeys_sent: text_len=$('{text}'.Length)"
            Write-Output "RESULT:OK"
        }} else {{
            Write-Output "RESULT:FALLBACK"
        }}
        "#,
        pid = pid,
        text = escaped_ps
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    // Always log full diagnostic to stderr (visible in debug or log files)
    eprintln!("[Pulse send_command pid={}] stdout:\n{}\nstderr: {}", pid, stdout, stderr);

    if stdout.contains("RESULT:OK") {
        Ok(stdout)
    } else if stdout.contains("RESULT:FALLBACK") {
        Err(format!("No window found in process chain. Diagnostics:\n{}", stdout))
    } else if !stderr.is_empty() {
        Err(format!("PowerShell error: {}\n\nStdout: {}", stderr, stdout))
    } else {
        Err(format!("Unknown state. Stdout: {}", stdout))
    }
}

/// Trigger /compact in a Claude Code CLI session (legacy wrapper).
pub fn trigger_compact(pid: u32) -> Result<String, String> {
    send_command(pid, "/compact")
}
