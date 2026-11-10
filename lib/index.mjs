/**
 * dsh-wps-office — DeepSeek Harness plugin (bundle).
 *
 * Turns the 250-tool `wps-office-mcp` MCP server into a compact model-facing
 * surface: four application-scoped facade tools (`wps_excel`, `wps_word`,
 * `wps_ppt`, `wps_office`) plus one discovery tool (`wps_help`). Each facade
 * takes `{ method, args }` and dispatches over MCP `tools/call`, so the model
 * pays for five small schemas instead of 250 full ones.
 *
 * The same bundle embeds the four upstream WPS skills (wps-excel / wps-word /
 * wps-ppt / wps-office). Their bodies keep their original guidance; a short
 * convention header explains that `wps_excel_<method>(args)` is now written as
 * `wps_excel({ method: "<method>", args })`.
 *
 * The MCP server is vendored under `vendor/wps-office-mcp` (upstream:
 * https://github.com/lc2panda/wps-skills, MIT). It is spawned lazily as a
 * stdio child process; a connection failure never fails plugin activation, and
 * the next tool call retries.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const name = 'dsh-wps-office';
/** `tools` is the only hard requirement; `skills` and `agents` are optional. */
export const inject = ['tools'];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER_ENTRY = path.join(ROOT, 'vendor', 'wps-office-mcp', 'dist', 'index.js');
const SERVER_CWD = path.dirname(SERVER_ENTRY);
const SKILL_ROOT = path.join(ROOT, 'skill');
const VERSION = '0.1.0';

const DEFAULTS = Object.freeze({
  enabled: true,
  eagerConnect: true,
  connectTimeoutMs: 20_000,
  requestTimeoutMs: 120_000,
  skillNote: true,
  command: undefined,
  args: undefined,
  cwd: undefined,
  env: undefined,
});

/** Application namespaces and the hint shown in each facade description. */
const APPS = Object.freeze({
  excel: {
    label: 'WPS 表格',
    tool: 'wps_excel',
    hint: 'generate_formula / read_range / write_range / set_formula / clean_data / create_chart',
  },
  word: {
    label: 'WPS 文字',
    tool: 'wps_word',
    hint: 'insert_text / apply_style / set_font / generate_toc / replace_range / insert_table',
  },
  ppt: {
    label: 'WPS 演示',
    tool: 'wps_ppt',
    hint: 'add_slide / beautify / unify_font / set_text / create_styled_table / delete_slide',
  },
  office: {
    label: 'WPS Office 通用',
    tool: 'wps_office',
    hint: 'check_connection / get_active_document / get_active_workbook / get_active_presentation / execute_method / convert_to_pdf',
  },
});
const APP_NAMES = Object.keys(APPS);

/** Skills shipped inside the bundle, in catalog order. */
const SKILLS = Object.freeze([
  { name: 'wps-excel', dir: 'wps-excel', app: 'excel' },
  { name: 'wps-word', dir: 'wps-word', app: 'word' },
  { name: 'wps-ppt', dir: 'wps-ppt', app: 'ppt' },
  { name: 'wps-office', dir: 'wps-office', app: 'office' },
]);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeLogger(ctx) {
  const logger = ctx?.logger;
  if (logger && typeof logger.info === 'function') {
    return {
      info: (message) => logger.info(message),
      warn: (message) => logger.warn(message),
      debug: (message) => (typeof logger.debug === 'function' ? logger.debug(message) : undefined),
    };
  }
  return {
    info: (message) => console.info(message),
    warn: (message) => console.warn(message),
    debug: () => {},
  };
}

function withTimeout(promise, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Split `--- key: value ---` frontmatter from a markdown document. */
export function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!entry) continue;
    meta[entry[1]] = entry[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: raw.slice(match[0].length) };
}

function oneLine(text, max = 96) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The vendored server must run under plain Node. Prefer the runtime bundled
 * with the desktop app, then any compatible host binary, then PATH `node`.
 */
export function resolveNodeBinary() {
  const bundled = path.join(
    path.dirname(process.execPath),
    'resources',
    'runtime',
    'primary-runtime',
    'dependencies',
    'node',
    'bin',
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  if (existsSync(bundled)) return bundled;
  if (process.versions?.electron) return process.execPath;
  return 'node';
}

/** Normalize an MCP result into the model-facing text the facade returns. */
export function formatResult(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const parts = [];
  let images = 0;
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'image') images += 1;
    else if (block?.type === 'resource') parts.push(`[资源] ${block.resource?.uri ?? ''}`);
    else parts.push(`[${block?.type ?? 'unknown'}]`);
  }
  let text = parts.join('\n').trim();
  if (images > 0) text += `${text ? '\n' : ''}[图片输出 ${images} 张；门面工具只回传文本]`;
  if (result?.structuredContent !== undefined) {
    text += `${text ? '\n\n' : ''}结构化数据：\n${JSON.stringify(result.structuredContent, null, 2)}`;
  }
  if (!text) text = JSON.stringify(result ?? null);
  return text;
}

/** Build the group catalog from a raw MCP `tools/list` response. */
export function buildCatalog(tools) {
  const groups = Object.fromEntries(APP_NAMES.map((app) => [app, []]));
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string') continue;
    const matched = /^wps_(excel|word|ppt)_(.+)$/.exec(tool.name);
    const app = matched ? matched[1] : 'office';
    const method = matched ? matched[2] : tool.name.replace(/^wps_/, '');
    groups[app].push({
      raw: tool.name,
      method,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    });
  }
  const counts = Object.fromEntries(APP_NAMES.map((app) => [app, groups[app].length]));
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return { groups, counts, total };
}

/** Map a facade `method` argument onto the underlying MCP tool name. */
export function resolveRawToolName(app, method) {
  if (method.startsWith('wps_')) return method;
  return app === 'office' ? `wps_${method}` : `wps_${app}_${method}`;
}

/** Map `wps_excel_generate_formula` style names onto the facade convention. */
export function buildSkillNote(app) {
  const meta = APPS[app];
  return [
    `> **DeepSeek Harness 调用约定（wps-office 插件）**`,
    `> 本技能运行在 DSH 的 wps-office 插件里，底层 250 个 MCP 工具已被收敛为门面工具，**不要**直接调用 \`wps_${app}_*\` 这类工具名：`,
    `> - 文中 \`wps_${app}_<method>(args)\` 一律写成 \`${meta.tool}({ method: "<method>", args: { ... } })\`；`,
    `> - 不确定方法名或参数时先调 \`wps_help({ app: "${app}" })\`，查单个方法用 \`wps_help({ app: "${app}", method: "<method>" })\`。`,
    '',
  ].join('\n');
}

/** Compose the registered skill body: convention header + upstream content. */
export function buildSkillContent(app, body, { includeNote = true } = {}) {
  return includeNote ? `${buildSkillNote(app)}${body}` : body;
}

/* ------------------------------------------------------------------ */
/* MCP bridge                                                          */
/* ------------------------------------------------------------------ */

/**
 * Owns the stdio MCP connection and exposes the facade operations.
 * Kept independent of cordis so it can be exercised from a plain script.
 */
export function createBridge(rawConfig, logger) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  const command = config.command ?? resolveNodeBinary();
  const args = Array.isArray(config.args) ? config.args : [SERVER_ENTRY];
  const state = {
    client: null,
    connecting: null,
    catalog: null,
    stderr: '',
    lastError: null,
  };

  const childEnv = () => {
    const env = { ...process.env, ...(config.env ?? {}) };
    if (command === process.execPath && process.versions?.electron) env.ELECTRON_RUN_AS_NODE = '1';
    return env;
  };

  const describeError = (error) => {
    const base = error instanceof Error ? error.message : String(error);
    const tail = state.stderr.trim();
    if (!tail) return base;
    return `${base}\n--- WPS MCP server stderr（末尾）---\n${tail.slice(-1200)}`;
  };

  async function doConnect() {
    if (!existsSync(SERVER_ENTRY) && !Array.isArray(config.args)) {
      throw new Error(`缺少内置 WPS MCP server 入口：${SERVER_ENTRY}`);
    }
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: config.cwd ?? SERVER_CWD,
      env: childEnv(),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => {
      state.stderr = `${state.stderr}${chunk.toString()}`.slice(-8000);
    });
    const client = new Client({ name: 'dsh-wps-office', version: VERSION }, { capabilities: {} });
    try {
      await withTimeout(client.connect(transport), config.connectTimeoutMs, '连接 WPS MCP server 超时');
      const listed = await withTimeout(client.listTools(), config.connectTimeoutMs, '列出 WPS 工具超时');
      state.catalog = buildCatalog(listed?.tools ?? []);
      state.client = client;
      state.lastError = null;
      logger.info(`wps-office: MCP server 已连接，发现 ${state.catalog.total} 个底层工具`);
      return client;
    } catch (error) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      state.lastError = error;
      throw new Error(describeError(error));
    }
  }

  function connect() {
    if (state.client) return Promise.resolve(state.client);
    if (state.connecting) return state.connecting;
    state.connecting = doConnect().finally(() => {
      state.connecting = null;
    });
    return state.connecting;
  }

  async function call(rawName, callArgs) {
    const client = await connect();
    let result;
    try {
      result = await client.callTool(
        { name: rawName, arguments: callArgs ?? {} },
        undefined,
        { timeout: config.requestTimeoutMs },
      );
    } catch (error) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      state.client = null;
      throw new Error(`调用 ${rawName} 失败：${describeError(error)}`);
    }
    const text = formatResult(result);
    if (result?.isError) {
      throw new Error(text || `调用 ${rawName} 失败`);
    }
    return text;
  }

  function statusLine() {
    if (state.client) return 'MCP server 已连接';
    if (state.lastError) return `MCP server 未连接：${oneLine(state.lastError.message, 200)}`;
    return 'MCP server 尚未连接（首次调用时连接）';
  }

  async function ensureCatalog() {
    if (state.catalog) return state.catalog;
    await connect();
    return state.catalog;
  }

  async function help(input = {}) {
    const app = typeof input.app === 'string' ? input.app.trim() : '';
    const method = typeof input.method === 'string' ? input.method.trim() : '';
    const filter = typeof input.filter === 'string' ? input.filter.trim().toLowerCase() : '';
    if (app && !APPS[app]) {
      throw new Error(`未知应用 "${app}"；可用：${APP_NAMES.join(' / ')}`);
    }
    let catalog = null;
    try {
      catalog = await ensureCatalog();
    } catch {
      catalog = null;
    }
    if (!app) {
      const lines = [`WPS 门面插件 v${VERSION}`, `状态：${statusLine()}`];
      if (catalog) {
        lines.push(
          `底层方法数：excel ${catalog.counts.excel} / word ${catalog.counts.word} / ppt ${catalog.counts.ppt} / office ${catalog.counts.office}（共 ${catalog.total}）`,
        );
        lines.push('用法：wps_excel({ method: "generate_formula", args: { prompt: "..." } })');
        lines.push('查方法：wps_help({ app: "excel" })；查参数：wps_help({ app: "excel", method: "generate_formula" })');
      } else {
        lines.push('无法列出方法：连接 MCP server 失败。请确认本机已安装 WPS Office、已安装对应加载项并重启 WPS，然后重试。');
      }
      return lines.join('\n');
    }
    if (!catalog) throw new Error(`MCP server 未连接，无法列出 ${app} 方法。${statusLine()}`);
    const items = catalog.groups[app] ?? [];
    if (method) {
      const found = items.find((item) => item.method === method || item.raw === method);
      if (!found) {
        throw new Error(
          `未找到 ${app}.${method}。${app} 的方法示例：${items.slice(0, 8).map((item) => item.method).join(', ')} …；完整清单：wps_help({ app: "${app}" })`,
        );
      }
      return `${found.raw}\n${found.description}\n\n参数 schema：\n${JSON.stringify(found.inputSchema, null, 2)}`;
    }
    const rows = filter
      ? items.filter((item) => `${item.method} ${item.description}`.toLowerCase().includes(filter))
      : items;
    const head = `${APPS[app].label}可用方法 ${rows.length} 个；调用方式：${APPS[app].tool}({ method, args })`;
    const body = rows.map((item) => `- ${item.method}：${oneLine(item.description)}`).join('\n');
    return `${head}\n${body}`;
  }

  async function close() {
    const client = state.client;
    state.client = null;
    state.catalog = null;
    if (!client) return;
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }

  return {
    config,
    command,
    args,
    state,
    connect,
    call,
    help,
    close,
    statusLine,
    get catalog() {
      return state.catalog;
    },
  };
}

/* ------------------------------------------------------------------ */
/* tool definitions                                                    */
/* ------------------------------------------------------------------ */

function createAppTool(app, bridge) {
  const meta = APPS[app];
  return {
    name: meta.tool,
    description: [
      `调用 ${meta.label} 的 MCP 方法。`,
      `method 为底层工具名去掉前缀（例如 ${meta.hint}）；args 是该方法的参数对象。`,
      `不确定方法名或参数时先调用 wps_help（wps_help({ app: "${app}" }) 列出全部方法）。`,
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: `方法名，例如 ${meta.hint.split(' / ')[0]}；也可直接传完整 MCP 工具名`,
        },
        args: {
          type: 'object',
          description: '该方法的参数对象；字段与类型用 wps_help({ app, method }) 查询',
          additionalProperties: true,
        },
      },
      required: ['method'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    isConcurrencySafe: () => false,
    async execute(callArgs) {
      const method = typeof callArgs?.method === 'string' ? callArgs.method.trim() : '';
      if (!method) throw new Error(`${meta.tool} 需要 method 参数，例如 { method: "${meta.hint.split(' / ')[0]}" }`);
      return bridge.call(resolveRawToolName(app, method), callArgs?.args ?? {});
    },
  };
}

function createHelpTool(bridge) {
  return {
    name: 'wps_help',
    description:
      'WPS 门面插件的方法发现工具。不带参数：返回连接状态与各应用方法数；传 app：列出该方法清单；传 app+method：返回该方法的完整参数 schema。开始任何 WPS 任务前若不确定方法名，先调用本工具。',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', enum: APP_NAMES, description: '应用名' },
        method: { type: 'string', description: '方法名（需同时传 app）' },
        filter: { type: 'string', description: '按关键字过滤方法名/描述（仅在传 app 时生效）' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    isConcurrencySafe: () => true,
    async execute(callArgs) {
      return bridge.help(callArgs ?? {});
    },
  };
}

/* ------------------------------------------------------------------ */
/* skills                                                              */
/* ------------------------------------------------------------------ */

function registerSkills(targetCtx, logger, { includeNote = true } = {}) {
  const skills = targetCtx?.get?.('skills');
  if (!skills || typeof skills.register !== 'function') {
    logger.warn('wps-office: 未找到 skills 服务，跳过技能注册');
    return () => {};
  }
  const disposers = [];
  for (const spec of SKILLS) {
    try {
      const file = path.join(SKILL_ROOT, spec.dir, 'SKILL.md');
      const raw = readFileSync(file, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const dispose = skills.register({
        name: spec.name,
        description: meta.description ?? `${APPS[spec.app].label}智能助手`,
        content: buildSkillContent(spec.app, body, { includeNote }),
        source: 'bundled',
        resourceBase: { kind: 'directory', path: path.join(SKILL_ROOT, spec.dir) },
      });
      disposers.push(dispose);
    } catch (error) {
      logger.warn(`wps-office: 注册技能 ${spec.name} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  logger.info(`wps-office: 已注册技能 ${disposers.length}/${SKILLS.length} 个（${SKILLS.map((item) => item.name).join(' / ')}）`);
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * Register the embedded skills per agent when the agents service exists, so
 * they win over a same-named filesystem skill in `~/.agents/skills` (global
 * layer). Falls back to a plugin-level registration when no agents service is
 * mounted.
 */
function armSkills(ctx, logger, options) {
  const disposers = new Map();
  const registerFor = (agent) => {
    if (disposers.has(agent)) return;
    const target = agent?.ctx ?? ctx;
    try {
      disposers.set(agent, registerSkills(target, logger, options));
    } catch (error) {
      logger.warn(`wps-office: 技能注册失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  let stopCreated = () => {};
  let stopDisposed = () => {};
  const agents = ctx.get?.('agents');
  const hasAgents = agents && typeof agents.list === 'function';
  if (hasAgents && typeof ctx.on === 'function') {
    try {
      stopCreated = ctx.on('agent/created', ({ agent }) => registerFor(agent)) ?? (() => {});
      stopDisposed =
        ctx.on('agent/disposed', ({ agent }) => {
          disposers.get(agent)?.();
          disposers.delete(agent);
        }) ?? (() => {});
    } catch {
      /* events unsupported: fall through to the immediate pass */
    }
  }
  if (hasAgents) {
    try {
      for (const agent of agents.list()) registerFor(agent);
    } catch {
      /* ignore */
    }
  } else {
    registerFor(null);
  }
  return () => {
    stopCreated();
    stopDisposed();
    for (const dispose of disposers.values()) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
    disposers.clear();
  };
}

/* ------------------------------------------------------------------ */
/* plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  const logger = makeLogger(ctx);
  if (config.enabled === false) {
    logger.info('wps-office: 已按配置禁用');
    return;
  }
  const bridge = createBridge(config, logger);
  const disposers = [];
  for (const app of APP_NAMES) {
    disposers.push(ctx.tools.register(createAppTool(app, bridge)));
  }
  disposers.push(ctx.tools.register(createHelpTool(bridge)));
  logger.info(`wps-office: 已注册 ${APP_NAMES.length + 1} 个门面工具（底层 250 个 MCP 工具按需转发）`);

  const disposeSkills = armSkills(ctx, logger, { includeNote: config.skillNote !== false });

  if (config.eagerConnect !== false) {
    bridge.connect().catch((error) => {
      logger.warn(`wps-office: 预连接 MCP server 失败（首次工具调用会重试）：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const cleanup = () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
    disposeSkills();
    void bridge.close();
  };
  if (typeof ctx.effect === 'function') ctx.effect(() => cleanup);
  else if (typeof ctx.on === 'function') ctx.on('dispose', cleanup);
}

export const __internal = {
  createBridge,
  createAppTool,
  createHelpTool,
  buildCatalog,
  buildSkillContent,
  buildSkillNote,
  formatResult,
  parseFrontmatter,
  resolveNodeBinary,
  resolveRawToolName,
  registerSkills,
};
