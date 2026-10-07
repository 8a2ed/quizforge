declare module "mammoth" {
  export interface RawTextResult {
    value: string;
    messages: any[];
  }
  export function extractRawText(input: { arrayBuffer: ArrayBuffer } | { buffer: Buffer } | { path: string }): Promise<RawTextResult>;
  export function convertToHtml(input: any, options?: any): Promise<{ value: string; messages: any[] }>;
  export function convertToMarkdown(input: any, options?: any): Promise<{ value: string; messages: any[] }>;
}
