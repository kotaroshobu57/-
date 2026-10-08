// Compatibility export: all production and verification reads use this reader.
// The former ExcelJS private stream adapter is retired (prefix / UTF-8 bugs).
export {readWorkbook} from './workbook-reader';
