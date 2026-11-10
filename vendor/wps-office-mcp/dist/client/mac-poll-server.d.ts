/**
 * Input: WPS 指令与HTTP请求
 * Output: 轮询执行结果（含 Issue #17 已连接检测，避免 pkill 杀死已运行 WPS）
 * Pos: macOS/Linux 轮询服务器实现，MCP Server 与 WPS 加载项之间的桥梁
 * 一旦我被修改，请更新我的头部注释，以及所属文件夹的md。
 * Mac轮询服务器 - 老王出品
 *
 * 丢，WPS Mac加载项在沙箱里启动不了HTTP服务器，只能反过来：
 * - MCP Server 作为HTTP服务端（端口58891）
 * - WPS加载项 作为HTTP客户端轮询获取命令
 *
 * 这SB架构虽然绕，但确实能跑通！
 */
/**
 * Mac轮询服务器类
 * 处理WPS加载项的轮询请求，实现命令的发送和结果接收
 */
declare class MacPollServer {
    private server;
    private pendingCommand;
    private currentApp;
    private _isRunning;
    private port;
    /** Issue #17: 记录最近一次 WPS 加载项 poll 请求的时间戳，用于判断加载项是否已连接 */
    private lastPollTime;
    get isRunning(): boolean;
    /**
     * 启动轮询服务器
     * 丢，这个服务器要处理三种请求：
     * 1. GET /poll - WPS加载项来轮询获取命令
     * 2. POST /result - WPS加载项返回执行结果
     * 3. OPTIONS - 该死的CORS预检请求
     */
    start(listenPort?: number): Promise<void>;
    /**
     * 处理轮询请求
     * WPS加载项每500ms来问一次：有活干不？
     */
    private handlePoll;
    /**
     * 处理结果返回
     * WPS加载项执行完命令后把结果POST回来
     */
    private handleResult;
    /**
     * 执行WPS命令
     * 这是对外的主要接口，调用后会：
     * 1. 检查是否需要切换应用
     * 2. 把命令放到队列里等WPS加载项来取
     * 3. 等待结果返回
     */
    executeCommand(action: string, params?: Record<string, unknown>, timeout?: number): Promise<unknown>;
    /**
     * 根据命令获取需要的应用类型
     */
    private getRequiredApp;
    /**
     * 切换WPS应用
     * 调用wps-auto.sh脚本自动关闭当前应用并启动目标应用
     */
    private switchApp;
    /**
     * 停止服务器
     */
    stop(): void;
    /**
     * 获取当前连接的应用类型
     */
    getCurrentApp(): string;
    /**
     * 设置当前应用（用于外部更新状态）
     */
    setCurrentApp(app: string): void;
}
export declare const macPollServer: MacPollServer;
export default MacPollServer;
//# sourceMappingURL=mac-poll-server.d.ts.map