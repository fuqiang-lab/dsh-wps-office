/**
 * Input: WPS 服务地址与保活间隔
 * Output: 服务保活状态
 * Pos: WPS 服务保活器。一旦我被修改，请更新我的头部注释，以及所属文件夹的md。
 * WPS服务保活器 - 老王的保活神器
 * 定期检查WPS内置HTTP服务，断了就自动重启
 */
/**
 * 检查WPS服务是否在运行
 */
declare function checkService(): Promise<boolean>;
/**
 * 启动保活服务
 */
export declare function startKeepalive(): void;
/**
 * 停止保活服务
 */
export declare function stopKeepalive(): void;
/**
 * 确保WPS服务可用（调用前先确保服务启动）
 */
export declare function ensureService(): Promise<boolean>;
export { checkService };
//# sourceMappingURL=wps-keepalive.d.ts.map