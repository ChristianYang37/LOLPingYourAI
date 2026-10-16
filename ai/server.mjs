import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' }, num = { type: 'number' };
export const toolDefinitions = [
  { name: 'get_context', description: 'Read the current ping, target, effective configuration and contextId before acting.', inputSchema: object({}) },
  { name: 'screenshot', description: 'Capture the current target again, resolving its position. Optionally center on x/y global logical coordinates within the same target to explore adjacent content. Returns a square image and coordinate mapping.', inputSchema: object({ contextId: str, x: num, y: num }, ['contextId']) },
  { name: 'desktop_action', description: 'Operate only the current target window. x/y are GLOBAL LOGICAL desktop coordinates, not image pixels. Use current screenshot mapping. For exploration clicks provide purpose describing the navigation; do not edit or submit. maximize and restore preserve the previous window bounds.', inputSchema: object({ contextId: str, purpose: str, action: { enum: ['click', 'type', 'key', 'scroll', 'maximize', 'restore'] }, x: num, y: num, text: str, key: str, delta: num, button: { enum: ['left', 'right'] } }, ['contextId', 'action']) },
  { name: 'reply_ping', description: 'Display an agent ping without moving the pointer or creating a new user event. Set meaning=reaction for a playful question during ongoing work so it does not ask the user to answer.', inputSchema: object({ contextId: str, signal: str, meaning: { enum: ['reaction', 'clarification', 'status'] }, at: { enum: ['target', 'cursor'] }, caption: str }, ['contextId', 'signal']) },
  { name: 'save_handoff', description: 'Save a concise goal, progress and next step for future sessions.', inputSchema: object({ contextId: str, summary: str, goal: str }, ['contextId', 'summary']) },
  { name: 'ward', description: 'Register one follow-up for the current window, or cancel its pending visits.', inputSchema: object({ contextId: str, cancel: { type: 'boolean' } }, ['contextId']) },
  { name: 'submit_icon', description: 'Submit a generated SVG or PNG image as an icon candidate for user preview. Prefer an available image-generation tool; otherwise draw a standalone original SVG. Never fetch remote assets.', inputSchema: object({ name: str, svg: str, pngBase64: str }, ['name']) },
];

export async function startBridge(service, store, extra = {}, { only = null, persist = true } = {}) {
  const token = randomBytes(32).toString('hex');
  const handlers = {
    status: () => service.status(), models: args => service.listModels(args), conversation: args => service.conversation.page(args), config: args => service.configure(args), ping: args => service.dispatch(args), message: args => service.message(args), stop: () => { service.generation++; return service.stop(); }, bind: args => service.bind(args), approve: args => service.approve(args),
    doctor: async () => ({ desktop: await service.desktop.doctor(), harnesses: await Promise.all(Object.entries(service.adapters).map(async ([name, a]) => { try { return { name, ...await a.capabilities() }; } catch (e) { return { name, error: e.message }; } })) }),
    tools: () => toolDefinitions.filter(t => t.name !== 'submit_icon'),
    get_context: () => service.context ?? { message: 'No ping has been received' },
    screenshot: async args => { const capture = await service.screenshot(args.contextId, args.x !== undefined || args.y !== undefined ? { x: args.x, y: args.y } : undefined); return { content: [{ type: 'image', mimeType: 'image/png', data: (await readFile(capture.imagePath)).toString('base64') }, { type: 'text', text: JSON.stringify({ target: capture.target, region: capture.region }) }] }; },
    desktop_action: args => service.action(args), reply_ping: args => service.reply(args), save_handoff: args => service.handoff(args),
    ward: async args => { const c = service.checkContext(args.contextId); if (!c.target) throw new Error('Ping a window before registering a ward'); return args.cancel ? service.wards.cancel(c.target.id) : service.wards.add(c.target, service.config.wardHours, c.harness); },
    ...extra,
  };
  if (only) { for (const name of Object.keys(handlers)) if (!only.includes(name) && name !== 'tools') delete handlers[name];
    handlers.tools = () => toolDefinitions.filter(t => only.includes(t.name)); }
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const supplied = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (req.headers.origin || supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) { res.writeHead(401); res.end('{"error":"Unauthorized"}'); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end('{}'); return; }
    try {
      let length = 0, body = '';
      for await (const chunk of req) { length += chunk.length; if (length > 12000000) throw new Error('Request too large'); body += chunk; }
      const method = req.url.slice(1), handler = handlers[method];
      if (!Object.hasOwn(handlers, method) || typeof handler !== 'function') throw new Error('Unknown operation');
      const result = await handler(JSON.parse(body || '{}'));
      res.end(JSON.stringify(result ?? { ok: true }));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  if (persist) await store.write('bridge', { endpoint, token, pid: process.pid });
  return { endpoint, token, close: () => server.close() };
}
