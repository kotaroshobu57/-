// Internal server-side options; never sourced from HTTP bodies or environment variables.
export interface WorkbookOptions { trustedLocalFullWorkbook?:true; }
export const TRUSTED_LOCAL_EXPANDED_BYTES=2*1024*1024*1024;
export function requireLocalWorkbookPath(file:string){
 if(/^[a-z][a-z\d+.-]*:\/\//i.test(file)||file.startsWith('file:')||file.startsWith('\\\\'))throw Error('全国CLIはローカルファイルパスのみ使用できます');
}
