import dotenv from 'dotenv';
import { executeMCPCommand } from '../src/services/claude-mcp.js';

// Load environment variables from .env
dotenv.config();

async function main() {
  try {
    console.log('Sending test command to Claude MCP...');

    // Send a simple test command
    const result = await executeMCPCommand('Return a simple hello message');

    // Log the full result for inspection
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
