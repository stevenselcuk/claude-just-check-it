# Just Check It: Claude Auto QA, Debugger & UI/UX Verifier (MCP Server)

[![npm version](https://img.shields.io/npm/v/claude-just-check-it.svg)](https://www.npmjs.com/package/claude-just-check-it)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An elite, autonomous Quality Assurance, Debugging, and UI/UX Verification engineer for **Claude Desktop**. Built on the Model Context Protocol (MCP).

This tool doesn't just take screenshots. It reads your codebase, figures out how to log in, dynamically pilots a headless browser, compares your live UI against Figma design files, injects debug logs to trace complex state bugs, and cleans up perfectly after itself.

## ✨ Features

- 🕵️ **Deep Auto-Discovery**: Greps your `.env`, seeders, and codebase to automatically extract test emails, passwords, routes, and `data-testid` selectors.
- 🛣️ **Dynamic Playwright Journeys**: Claude writes its own Playwright scripts on the fly. It can navigate, fill forms, click buttons, and handle complex login flows.
- 🎨 **UI/UX Pixel Verification Mode**: Pass Claude a design mockup image. It will render your live local site, pull both images into its context window, and provide a pixel-perfect CSS audit of what you missed.
- 💉 **Deep Debug Injection**: If a bug is hidden in React/Next.js state, Claude will dynamically inject `console.log()` into your files, run the browser, read the logs, and find the bug.
- 🧹 **Absolute Cleanup**: Every injected log is reverted. Every Node/Vite process is ruthlessly killed (`process.kill(-pid)`). Zero zombie footprint.

## 📦 Installation for Claude Desktop

1. Open your Claude Desktop config file:
   - **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the following MCP server configuration:

\`\`\`json
{
"mcpServers": {
"just-check-it": {
"command": "npx",
"args":[
"-y",
"claude-just-check-it"
]
}
}
}
\`\`\`

1. **Restart Claude Desktop.**

## 🛠️ Provided Tools

1. `discover_project_context`: Extracts routes, credentials, and selectors.
2. `start_project`: Boots the dev server safely.
3. `execute_playwright_journey`: Executes sequential browser arrays (goto, fill, click).
4. `verify_ui_against_design`: Captures live UI and compares it alongside a user's mockup.
5. `inject_debug_logs`: Temporarily mutates files for deep state tracing.
6. `cleanup_session`: Reverts files and terminates processes.

## 🤝 Contributing

Open to PRs. This is designed to be the ultimate companion for AI-driven software development.

## 🤝 Contributing

Open to PRs. This is designed to be the ultimate companion for AI-driven software development.
