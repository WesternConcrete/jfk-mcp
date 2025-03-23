# JFK MCP 

This MCP server leverages the Archives API to query JFK documents. You can obtain your API key from [archives-api.com](https://archives-api.com).

Below is the JSON configuration for MCP Claude Desktop. Replace `"your-api-key-here"` with your actual Archives API key.

```json
{
  "mcpServers": {
    "jfk-mcp": {
      "command": "npx",
      "args": ["-y", "jfk-mcp"],
      "env": {
        "ARCHIVES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Github: https://github.com/WesternConcrete/jfk-mcp

NPM: https://www.npmjs.com/package/jfk-mcp

