import { z } from 'zod';
import { Rational, MATERIAL_UNITS, type MaterialCode } from '@designflow/construction-calculations';
export const COST_ENGINE_VERSION = 'boq-cost-v1';
export const COST_LIMITS = { sourceBytes: 16_777_216, bookBytes: 262144, policyBytes: 65536, reportBytes: 24_000_000,
  entries: 512, rules: 128, adjustments: 32, lines: 60000, groups: 20000, warnings: 60010, matchingWork: 2_000_000 } as const;
export class CostError extends Error {
  constructor(readonly code: 'RATE_BOOK_INVALID'|'RATE_MATCH_AMBIGUOUS'|'COST_POLICY_INVALID'|'COST_RESOURCE_LIMIT'|'COST_CALCULATION_FAILED', message: string) { super(message); this.name='CostError'; }
}
export const compare = (a:string,b:string) => a<b?-1:a>b?1:0;
export const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
// PostgreSQL JSONB rejects NUL and unpaired UTF-16 surrogates. Reject them before signing.
export const text = z.string().min(1).max(500).refine(v=>!v.includes('\0')&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v),'Expected well-formed text without NUL');
export const decimal = z.string().max(300).regex(/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
export const exact = z.object({ numerator: z.string().max(600).regex(/^-?(0|[1-9][0-9]*)$/), denominator: z.string().max(600).regex(/^[1-9][0-9]*$/) }).strict();
export const money = z.string().max(300).regex(/^-?(0|[1-9][0-9]*)\.[0-9]{2}$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
const parameter = z.string().max(20).regex(/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/).transform(v=>Rational.from(v).decimal(6));
const positive = parameter.refine(v=>Rational.from(v).n>0n,'Must be positive');
const percent = parameter.refine(v=>Rational.from(v).cmp(Rational.from('100'))<=0,'Maximum percentage is 100');
export const CurrencySchema = z.enum(['INR','USD','EUR']);
export const RegionSchema = z.object({country:z.string().regex(/^[A-Z]{2}$/),region:text.optional(),city:text.optional(),regionCode:id.optional()}).strict();
const material = z.enum(Object.keys(MATERIAL_UNITS) as [MaterialCode,...MaterialCode[]]);
export const RateEntrySchema = z.object({code:id,materialCode:material,mode:z.enum(['PHYSICAL','PURCHASE']),
  unit:z.enum(['kg','m3','l','bag','piece','each']),bagMassKg:positive.nullable().default(null),rate:parameter,
  assemblyId:id.optional(),specificationId:text.optional(),provenance:text,
}).strict().superRefine((e,ctx)=>{
  if(e.mode==='PHYSICAL' && (e.unit!==MATERIAL_UNITS[e.materialCode] || ['piece','each'].includes(e.unit))) ctx.addIssue({code:'custom',message:'Physical unit mismatch; discrete units require purchase mode'});
  if(e.mode==='PURCHASE' && !((e.materialCode==='CEMENT' && e.unit==='bag') || (MATERIAL_UNITS[e.materialCode]===e.unit && ['piece','each'].includes(e.unit)))) ctx.addIssue({code:'custom',message:'Unsupported purchase conversion'});
  if((e.unit==='bag')!==(e.bagMassKg!==null)) ctx.addIssue({code:'custom',message:'Bag mass required only for bags'});
});
export const RateBookSchema = z.object({id,version:id,effectiveDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),region:RegionSchema,
  currency:CurrencySchema,minorUnits:z.literal(2),source:z.object({kind:z.enum(['SYNTHETIC','USER_SUPPLIED']),description:text}).strict(),
  entries:z.array(RateEntrySchema).max(COST_LIMITS.entries),
}).strict().superRefine((b,ctx)=>{
  if(new Set(b.entries.map(e=>e.code)).size!==b.entries.length) ctx.addIssue({code:'custom',message:'Duplicate entry code'});
  const keys=b.entries.map(e=>JSON.stringify([e.materialCode,e.mode,e.unit,e.bagMassKg,e.assemblyId??null,e.specificationId??null]));
  if(new Set(keys).size!==keys.length) ctx.addIssue({code:'custom',message:'Duplicate rate identity'});
}).transform(b=>({...b,entries:[...b.entries].sort((a,b)=>compare(a.code,b.code))}));
const laborBase={id,assemblyId:id,layerId:id,tradeCode:id,basisUnit:z.enum(['m2','m3','each']),provenance:text};
export const LaborRuleSchema=z.discriminatedUnion('mode',[
  z.object({...laborBase,mode:z.literal('DIRECT'),unitRate:parameter}).strict(),
  z.object({...laborBase,mode:z.literal('PRODUCTIVITY'),hoursPerUnit:positive,hourlyRate:parameter}).strict(),
]);
const adjustmentBase={code:id,label:text,category:z.enum(['OVERHEAD','CONTINGENCY','CHARGE','ADJUSTMENT']),order:z.number().int().min(0).max(1000),basis:z.enum(['MATERIAL','LABOR','DIRECT','RUNNING'])};
export const AdjustmentRuleSchema=z.discriminatedUnion('kind',[
  z.object({...adjustmentBase,kind:z.literal('PERCENT'),value:percent}).strict(),
  z.object({...adjustmentBase,kind:z.literal('FIXED_ADD'),value:parameter}).strict(),
  z.object({...adjustmentBase,kind:z.literal('FIXED_DEDUCT'),value:parameter}).strict(),
]);
export const CostingPolicySchema=z.object({id,version:id,currency:CurrencySchema,rounding:z.literal('HALF_UP_LINE_MINOR_UNITS'),
  physicalQuantity:z.literal('FINAL_EXACT'),laborRules:z.array(LaborRuleSchema).max(COST_LIMITS.rules),
  adjustments:z.array(AdjustmentRuleSchema).max(COST_LIMITS.adjustments),
}).strict().superRefine((p,ctx)=>{
  for(const keys of [p.laborRules.map(r=>r.id),p.laborRules.map(r=>JSON.stringify([r.assemblyId,r.layerId])),p.adjustments.map(r=>r.code),p.adjustments.map(r=>String(r.order))])
    if(new Set(keys).size!==keys.length) ctx.addIssue({code:'custom',message:'Duplicate rule, labor layer or adjustment order'});
}).transform(p=>({...p,laborRules:[...p.laborRules].sort((a,b)=>compare(a.id,b.id)),adjustments:[...p.adjustments].sort((a,b)=>a.order-b.order)}));
export const CostOptionsSchema=z.object({quantityDecimalPlaces:z.number().int().min(6).max(12).default(9)}).strict();
export const CostCoverageSchema=z.enum(['FULLY_PRICED','PARTIALLY_PRICED','NOT_PRICED']);
export type RateBook=z.infer<typeof RateBookSchema>;
export type RateBookInput=z.input<typeof RateBookSchema>;
export type CostingPolicy=z.infer<typeof CostingPolicySchema>;
export type CostingPolicyInput=z.input<typeof CostingPolicySchema>;
export function boundedJson(value:unknown,max:number){
  let encoded:string;try{encoded=JSON.stringify(value);if(encoded===undefined)throw new Error();}catch{throw new CostError('COST_CALCULATION_FAILED','Expected JSON-safe input');}
  if(Buffer.byteLength(encoded,'utf8')>max)throw new CostError('COST_RESOURCE_LIMIT','JSON size limit exceeded');
}
export function normalizeRateBook(input:unknown){boundedJson(input,COST_LIMITS.bookBytes);const r=RateBookSchema.safeParse(input);if(!r.success)throw new CostError(r.error.issues.some(i=>i.code==='too_big')?'COST_RESOURCE_LIMIT':'RATE_BOOK_INVALID','Invalid or oversized rate book');return r.data;}
export function normalizeCostingPolicy(input:unknown){boundedJson(input,COST_LIMITS.policyBytes);const r=CostingPolicySchema.safeParse(input);if(!r.success)throw new CostError(r.error.issues.some(i=>i.code==='too_big')?'COST_RESOURCE_LIMIT':'COST_POLICY_INVALID','Invalid or oversized costing policy');return r.data;}
