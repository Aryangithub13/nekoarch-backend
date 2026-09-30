import { z } from 'zod';
import { ConstructionStatusSchema } from '@designflow/construction-calculations';
import { COST_ENGINE_VERSION,COST_LIMITS,CostOptionsSchema,RateBookSchema,CostingPolicySchema,CostCoverageSchema,CurrencySchema,RegionSchema,text,id,decimal,exact,money,hash,AdjustmentRuleSchema } from './contracts.js';
export const BoqLineSchema=z.object({
  id:text,lineCode:text,category:z.enum(['MATERIAL','LABOR']),description:text,status:z.enum(['PRICED','UNPRICED','NOT_EVALUATED']),reason:text.nullable(),
  materialCode:text.nullable(),tradeCode:text.nullable(),sourceCalculationItemIds:z.array(text).length(1),sourceMaterialLineIds:z.array(text).max(1),
  sourceTakeoffItemIds:z.array(text).length(1),architecturalEntityIds:z.array(text).min(1).max(2),levelId:text.nullable(),assemblyId:text,specificationId:text.nullable(),layerId:text,
  quantity:decimal,quantityUnit:z.enum(['kg','m3','l','piece','each','m2']),quantityExact:exact,
  pricingQuantity:decimal.nullable(),pricingUnit:z.enum(['kg','m3','l','piece','each','m2','bag','hour']).nullable(),pricingQuantityExact:exact.nullable(),
  procurement:z.object({unit:z.enum(['bag','piece','each']),quantity:decimal,bagMassKg:decimal.nullable()}).strict().nullable(),
  unitRate:decimal.nullable(),currency:CurrencySchema,baseAmount:money.nullable(),baseAmountExact:exact.nullable(),upstreamStatus:ConstructionStatusSchema,
  rateProvenance:z.object({rateBookId:id,rateBookVersion:id,rateBookHash:hash,rateEntryCode:id}).strict().nullable(),
  laborRuleId:id.nullable(),
}).strict().superRefine((l,ctx)=>{
  const priced=l.status==='PRICED';
  for(const v of [l.pricingQuantity,l.pricingUnit,l.pricingQuantityExact,l.unitRate,l.baseAmount,l.baseAmountExact]) if((v!==null)!==priced)ctx.addIssue({code:'custom',message:'Price state mismatch'});
  if((l.reason===null)!==priced)ctx.addIssue({code:'custom',message:'Price reason mismatch'});
});
export const BoqCostReportSchema=z.object({engineVersion:z.literal(COST_ENGINE_VERSION),
  source:z.object({constructionEngineVersion:text,takeoffEngineVersion:text,measurementPolicyVersion:text,recipePack:z.object({id,version:id}).strict(),upstreamStatus:ConstructionStatusSchema}).strict(),
  rateBook:RateBookSchema,rateBookHash:hash,costingPolicy:CostingPolicySchema,costingPolicyHash:hash,currency:CurrencySchema,region:RegionSchema,options:CostOptionsSchema,
  boqLines:z.array(BoqLineSchema).max(COST_LIMITS.lines),unpricedLineIds:z.array(text).max(COST_LIMITS.lines),
  subtotals:z.object({material:money,labor:money,direct:money}).strict(),
  adjustments:z.array(z.object({id:text,category:z.literal('ADJUSTMENT'),rule:AdjustmentRuleSchema,basisAmount:money,amount:money,amountExact:exact}).strict()).max(COST_LIMITS.adjustments),
  finalTotals:z.object({pricedSubtotal:money,adjustmentsOnPricedSubtotal:money,pricedGrandTotal:money,completeTotalAvailable:z.boolean(),completeRepresentedScopeTotal:money.nullable()}).strict(),
  coverage:CostCoverageSchema,
  groups:z.array(z.object({dimension:z.enum(['category','material','level','assembly','specification','trade']),key:text.nullable(),lineIds:z.array(text).max(COST_LIMITS.lines),pricedAmount:money,unpricedCount:z.number().int().nonnegative()}).strict()).max(COST_LIMITS.groups),
  warnings:z.array(z.object({code:id,lineId:text.nullable()}).strict()).max(COST_LIMITS.warnings),
  assumptions:z.array(text).max(16),excludedScopes:z.array(text).max(16),
}).strict();
export type BoqCostReport=z.infer<typeof BoqCostReportSchema>;
export type BoqLine=z.infer<typeof BoqLineSchema>;
