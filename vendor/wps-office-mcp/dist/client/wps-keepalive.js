"use strict";
/**
 * Input: WPS 服务地址与保活间隔
 * Output: 服务保活状态
 * Pos: WPS 服务保活器。一旦我被修改，请更新我的头部注释，以及所属文件夹的md。
 * WPS服务保活器 - 老王的保活神器
 * 定期检查WPS内置HTTP服务，断了就自动重启
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startKeepalive = startKeepalive;
exports.stopKeepalive = stopKeepalive;
exports.ensureService = ensureService;
exports.checkService = checkService;
const axios_1 = __importDefault(require("axios"));
const child_process_1 = require("child_process");
const logger_1 = require("../utils/logger");
const WPS_SERVICE_URL = 'http://127.0.0.1:58890';
const CHECK_INTERVAL = 5000; // 5秒检查一次
const STARTUP_PROTOCOL = 'ksoWPSCloudSvr://start=RelayHttpServer';
let keepaliveTimer = null;
let isStarting = false;
/**
 * 检查WPS服务是否在运行
 */
async function checkService() {
    try {
        const res = await axios_1.default.post(`${WPS_SERVICE_URL}/version`, {}, { timeout: 2000 });
        return !!res.data;
    }
    catch {
        return false;
    }
}
/**
 * 启动WPS内置HTTP服务
 */
function startService() {
    return new Promise((resolve) => {
        if (isStarting) {
            resolve();
            return;
        }
        isStarting = true;
        logger_1.log.info('[Keepalive] Starting WPS relay service...');
        // Windows下通过start命令启动自定义协议
        (0, child_process_1.exec)(`start "" "${STARTUP_PROTOCOL}"`, (error) => {
            if (error) {
                logger_1.log.error('[Keepalive] Failed to start WPS service', error);
            }
            // 等待服务启动
            setTimeout(() => {
                isStarting = false;
                resolve();
            }, 3000);
        });
    });
}
/**
 * 保活循环
 */
async function keepaliveLoop() {
    const isRunning = await checkService();
    if (!isRunning) {
        logger_1.log.warn('[Keepalive] WPS service not running, restarting...');
        await startService();
    }
}
/**
 * 启动保活服务
 */
function startKeepalive() {
    if (keepaliveTimer) {
        return;
    }
    logger_1.log.info('[Keepalive] Starting WPS keepalive service');
    // 立即检查一次
    keepaliveLoop();
    // 定期检查
    keepaliveTimer = setInterval(keepaliveLoop, CHECK_INTERVAL);
}
/**
 * 停止保活服务
 */
function stopKeepalive() {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
        logger_1.log.info('[Keepalive] Stopped WPS keepalive service');
    }
}
/**
 * 确保WPS服务可用（调用前先确保服务启动）
 */
async function ensureService() {
    let retries = 3;
    while (retries > 0) {
        if (await checkService()) {
            return true;
        }
        await startService();
        retries--;
    }
    return false;
}
//# sourceMappingURL=wps-keepalive.js.map