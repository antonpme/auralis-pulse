#!/usr/bin/env node

/**
 * Auralis Pulse - Permission Forward Hook
 *
 * Sends permission requests to Auralis Pulse (localhost:59428)
 * for notification and optional remote response.
 *
 * Claude Code kills hooks after ~30s. We use 25s timeout to exit
 * cleanly before that, letting CLI handle permissions normally.
 *
 * If Pulse is not running, falls through silently (no blocking).
 */

const http = require('http');

const HOOK_TIMEOUT_MS = 25000; // 25s - exit before Claude Code's ~30s kill

async function main() {
  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name || 'Unknown';
  const toolInput = data.tool_input || {};
  const sessionId = data.session_id || '';

  // Try to forward to Pulse
  try {
    const response = await postToPulse({
      tool_name: toolName,
      tool_input: toolInput,
      session_id: sessionId,
    });

    // Map Pulse decision to Claude Code hookSpecificOutput format
    if (response && response.decision) {
      const decision = response.decision;

      // "dismiss" = user dismissed card, let CLI handle
      if (decision === 'dismiss') {
        process.exit(0);
      }

      // Claude Code only recognizes "allow" and "deny"
      // "allow_session" maps to "allow" (no persistent allow in hook format)
      const behavior = (decision === 'deny') ? 'deny' : 'allow';

      const output = {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: behavior,
          },
        },
      };

      process.stdout.write(JSON.stringify(output) + '\n');
    }
  } catch {
    // Pulse not running, timeout, or error - fall through silently
  }
}

function postToPulse(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const req = http.request({
      hostname: '127.0.0.1',
      port: 59428,
      path: '/permission',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: HOOK_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

main().catch(() => process.exit(0));
