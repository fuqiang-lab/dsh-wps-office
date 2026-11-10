/**
 * Standalone smoke test for the WPS bridge — no cordis host required.
 *
 *   node scripts/smoke.mjs
 *
 * Verifies: node binary resolution, MCP stdio handshake, tool catalog grouping,
 * wps_help listings, facade dispatch (unknown method), skill content assembly,
 * and one real call (wps_check_connection; a missing WPS add-in is reported,
 * not treated as a test failure).
 */
import { __internal } from '../lib/index.mjs';

const logger = {
  info: (message) => console.log(`[info] ${message}`),
  warn: (message) => console.warn(`[warn] ${message}`),
  debug: () => {},
};

const assert = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`[ok] ${label}`);
};

const bridge = __internal.createBridge({ eagerConnect: false }, logger);
console.log(`[info] command = ${bridge.command}`);
console.log(`[info] args    = ${JSON.stringify(bridge.args)}`);

// Tool definition shape (what ctx.tools.register would receive).
const excelTool = __internal.createAppTool('excel', bridge);
assert(excelTool.name === 'wps_excel', 'facade name wps_excel');
assert(excelTool.parameters.required.includes('method'), 'method is required');
assert(typeof excelTool.execute === 'function', 'execute present');
assert(__internal.resolveRawToolName('excel', 'generate_formula') === 'wps_excel_generate_formula', 'method mapping');
assert(__internal.resolveRawToolName('office', 'check_connection') === 'wps_check_connection', 'office mapping');

// Skill content assembly.
const content = __internal.buildSkillContent('excel', '# body\n');
assert(content.includes('wps_excel({ method:') && content.endsWith('# body\n'), 'skill note prepended');

// Connection + catalog.
const statusBefore = await bridge.help();
console.log(`[info] status before connect:\n${statusBefore}`);
await bridge.connect();
const catalog = bridge.catalog;
assert(catalog.total === catalog.counts.excel + catalog.counts.word + catalog.counts.ppt + catalog.counts.office, 'catalog totals add up');
assert(catalog.counts.excel >= 80 && catalog.counts.ppt >= 100, `catalog counts (${JSON.stringify(catalog.counts)})`);
console.log(`[ok] catalog total = ${catalog.total}`);

const listing = await bridge.help({ app: 'excel' });
assert(listing.startsWith('WPS 表格可用方法'), 'help lists excel methods');
const schema = await bridge.help({ app: 'excel', method: 'generate_formula' });
assert(schema.startsWith('wps_excel_generate_formula'), 'help returns full schema');
console.log(`[info] generate_formula schema head:\n${schema.slice(0, 220)}`);

// Dispatch to a missing tool must surface a clear error.
try {
  await bridge.call('wps_excel_definitely_not_a_method', {});
  throw new Error('FAILED: missing method should throw');
} catch (error) {
  if (String(error.message).startsWith('FAILED:')) throw error;
  assert(error.message.length > 0, 'unknown method reports an error');
}

// Real call — requires WPS + add-in; absence is reported, not fatal.
try {
  const text = await bridge.call('wps_check_connection', {});
  console.log(`[ok] wps_check_connection:\n${text.slice(0, 400)}`);
} catch (error) {
  console.warn(`[warn] wps_check_connection failed (WPS add-in missing?):\n${error.message.slice(0, 400)}`);
}

await bridge.close();
console.log('[done] smoke test finished');
