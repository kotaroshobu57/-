import {parseDate} from './history';
export function classifyDate(raw:string):{kind:'valid_date'|'datetime'|'time_only'|'url_in_date_column'|'invalid_date'|'empty';date?:string;raw:string}{
 const v=raw.trim();if(!v)return {kind:'empty',raw};if(/https?:\/\//i.test(v))return {kind:'url_in_date_column',raw};
 if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(v)||/^0?\.\d+$/.test(v))return {kind:'time_only',raw};
 const date=parseDate(v,true);if(!date)return {kind:'invalid_date',raw};
 return {kind:/\d:\d{2}/.test(v)||/^\d+\.\d+$/.test(v)?'datetime':'valid_date',date,raw};
}
