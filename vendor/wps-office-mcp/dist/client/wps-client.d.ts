/**
 * Input: 平台信息与WPS调用参数
 * Output: WPS API 调用结果
 * Pos: 跨平台 WPS 客户端。一旦我被修改，请更新我的头部注释，以及所属文件夹的md。
 * WPS通信客户端 - 老王的跨平台版
 * Windows: 通过PowerShell调用WPS COM接口
 * Mac: 通过反向轮询服务器（MCP Server当服务端，WPS加载项来轮询）
 *
 * 丢，为了兼容Mac老王可是费了老大劲了
 * WPS Mac加载项在沙箱里启动不了HTTP服务器，只能反过来搞！
 */
import { WpsEndpointConfig, WpsApiRequest, WpsApiResponse, WpsAppType, WpsClientStatus, DocumentInfo, WorkbookInfo, PresentationInfo } from '../types/wps';
export declare function setPptTarget(name?: string): void;
export declare function getPptTarget(): string | undefined;
/**
 * WPS客户端类 - 跨平台通信
 * Windows: PowerShell COM桥接
 * Mac: HTTP调用WPS加载项
 */
export declare class WpsClient {
    private status;
    constructor(_config?: Partial<WpsEndpointConfig>);
    /**
     * 调用WPS接口（跨平台）
     */
    invokeAction<T = unknown>(action: string, params?: Record<string, unknown>): Promise<WpsApiResponse<T>>;
    /**
     * 兼容旧API
     */
    callApi<T = unknown>(request: WpsApiRequest): Promise<WpsApiResponse<T>>;
    /**
     * 检查WPS连接状态
     */
    checkConnection(): Promise<boolean>;
    /**
     * 获取客户端状态
     */
    getStatus(): WpsClientStatus;
    getActiveWorkbook(): Promise<WorkbookInfo | null>;
    getCellValue(sheet: string | number, row: number, col: number): Promise<unknown>;
    setCellValue(sheet: string | number, row: number, col: number, value: unknown): Promise<boolean>;
    getRangeData(sheet: string | number, range: string): Promise<unknown[][]>;
    setRangeData(sheet: string | number, range: string, data: unknown[][]): Promise<boolean>;
    setFormula(sheet: string | number, row: number, col: number, formula: string): Promise<boolean>;
    getActiveDocument(): Promise<DocumentInfo | null>;
    createDocument(): Promise<boolean>;
    insertText(text: string, position?: number): Promise<boolean>;
    getDocumentText(): Promise<string>;
    getActivePresentation(): Promise<PresentationInfo | null>;
    createPresentation(): Promise<boolean>;
    addSlide(layout?: string): Promise<boolean>;
    executeMethod<T = unknown>(method: string, params?: Record<string, unknown>, appType?: WpsAppType): Promise<WpsApiResponse<T>>;
    openFile(filePath: string, _appType?: WpsAppType): Promise<boolean>;
    saveFile(_appType?: WpsAppType): Promise<boolean>;
    saveFileAs(filePath: string, _appType?: WpsAppType): Promise<boolean>;
}
export declare const wpsClient: WpsClient;
export default WpsClient;
//# sourceMappingURL=wps-client.d.ts.map