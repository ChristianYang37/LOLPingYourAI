#!/usr/bin/env node
import { createInterface } from 'node:readline';


const endpoint = process.env.LOLPINGAI_ENDPOINT, token = process.env.LOLPINGAI_TOKEN;
if (!endpoint || !token || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Missing local bridge connection');
async function call(method, args) {
  const result = await fetch(`${endpoint}/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(60000) });
  const data = await result.json(); if (!result.ok) throw new Error(data.error); return data;
}
createInterface({ input: process.stdin }).on('line', async line => {
  let request;
  try {
    request = JSON.parse(line); if (request.id === undefined) return;
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'lolpingyourai', version: '0.1.0' } };
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') result = { tools: await call('tools', {}) };
    else if (request.method === 'tools/call') {
      if (!(await call('tools', {})).some(t => t.name === request.params.name)) throw new Error('Unknown tool');
      try { const data = await call(request.params.name, request.params.arguments ?? {}); result = data.content ? data : { content: [{ type: 'text', text: JSON.stringify(data) }] }; }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
    } else throw new Error('Unsupported MCP method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32603, message: error.message } }) + '\n'); }
});
