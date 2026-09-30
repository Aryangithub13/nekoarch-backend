import { createHash } from 'node:crypto';
/** Validated JSON, sorted object keys; matches project_private.canonical_json. */
export function costCanonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(costCanonical).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${costCanonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function costHash(value:unknown){return createHash('sha256').update(costCanonical(value)).digest('hex');}
