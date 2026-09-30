import { ConstructionReportSchema,Rational,type CalculationItem,type ConstructionReport } from '@designflow/construction-calculations';
import { COST_ENGINE_VERSION,COST_LIMITS,CostError,CostOptionsSchema,compare,boundedJson,normalizeRateBook,normalizeCostingPolicy } from './contracts.js';
import { costHash,costCanonical } from './hash.js';
import { BoqCostReportSchema,type BoqLine,type BoqCostReport } from './report.js';
const R=Rational.from;
const fromExact=(e:{numerator:string;denominator:string})=>new Rational(BigInt(e.numerator),BigInt(e.denominator));
export function moneyString(v:Rational):string {
  const negative=v.n<0n, n=negative?-v.n:v.n;
  const cents=(n*200n+v.d)/(2n*v.d), digits=cents.toString().padStart(3,'0');
  return `${negative&&cents!==0n?'-':''}${digits.slice(0,-2)}.${digits.slice(-2)}`;
}
const sortObjects=<T>(values:T[])=>[...values].sort((a,b)=>compare(costCanonical(a),costCanonical(b)));
function normalizeSource(input:unknown):ConstructionReport {
  boundedJson(input,COST_LIMITS.sourceBytes);
  const parsed=ConstructionReportSchema.safeParse(input);
  if(!parsed.success)throw new CostError(parsed.error.issues.some(i=>i.code==='too_big')?'COST_RESOURCE_LIMIT':'COST_CALCULATION_FAILED','Invalid or oversized construction report');
  const s=parsed.data;
  const totals=(values:ConstructionReport['summary']['totals'])=>sortObjects(values.map(v=>({...v,purchases:sortObjects(v.purchases)})));
  return {...s,items:[...s.items].sort((a,b)=>compare(a.id,b.id)),materials:[...s.materials].sort((a,b)=>compare(a.id,b.id)),
    coverage:sortObjects(s.coverage),warnings:sortObjects(s.warnings),summary:{...s.summary,totals:totals(s.summary.totals)},
    sections:sortObjects(s.sections.map(v=>({...v,totals:totals(v.totals)})))};
}
export function calculateBoqCost(sourceInput:unknown,bookInput:unknown,policyInput:unknown,optionsInput:unknown={}):BoqCostReport {
  const source=normalizeSource(sourceInput),book=normalizeRateBook(bookInput),policy=normalizeCostingPolicy(policyInput);
  boundedJson(optionsInput,1024);const opts=CostOptionsSchema.safeParse(optionsInput);
  if(!opts.success)throw new CostError('COST_POLICY_INVALID','Invalid cost options');const options=opts.data;
  if(policy.currency!==book.currency)throw new CostError('COST_POLICY_INVALID','Policy and rate-book currencies differ');
  if(source.materials.length+source.items.length>COST_LIMITS.lines || source.materials.length*book.entries.length+source.items.length*policy.laborRules.length>COST_LIMITS.matchingWork)
    throw new CostError('COST_RESOURCE_LIMIT','Line or matching work limit exceeded');
  const items=new Map(source.items.map(i=>[i.id,i]));
  if(items.size!==source.items.length || new Set(source.materials.map(m=>m.id)).size!==source.materials.length)
    throw new CostError('COST_CALCULATION_FAILED','Duplicate authoritative source identity');
  const bookHash=costHash(book),policyHash=costHash(policy),lines:BoqLine[]=[],warnings:BoqCostReport['warnings']=[];
  const warn=(code:string,lineId:string|null=null)=>{warnings.push({code,lineId});if(warnings.length>COST_LIMITS.warnings)throw new CostError('COST_RESOURCE_LIMIT','Warning limit exceeded');};
  if(book.source.kind==='SYNTHETIC')warn('COST_SAMPLE_RATE_BOOK');
  warn('COST_EQUIPMENT_NOT_EVALUATED');warn('COST_TRANSPORT_NOT_EVALUATED');
  if(source.summary.status!=='EVALUATED' || source.coverage.some(c=>c.status!=='EVALUATED'))warn('COST_PARTIAL_UPSTREAM_QUANTITY');
  const common=(item:CalculationItem)=>({sourceCalculationItemIds:[item.id],sourceTakeoffItemIds:[item.takeoffItemId],architecturalEntityIds:[...item.sourceEntityIds].sort(compare),
    levelId:item.levelId,assemblyId:item.assemblyId,specificationId:item.specificationId,layerId:item.layerId,currency:book.currency,upstreamStatus:item.status,
    pricingQuantity:null,pricingQuantityExact:null,pricingUnit:null,unitRate:null,baseAmount:null,baseAmountExact:null,rateProvenance:null,laborRuleId:null});
  for(const m of source.materials){
    const item=items.get(m.calculationItemId);
    if(!item || item.status==='NOT_EVALUATED')throw new CostError('COST_CALCULATION_FAILED','Material has no evaluated authoritative calculation');
    const quantity=fromExact(m.finalExact);
    const line:BoqLine={...common(item),id:`material:${costHash([COST_ENGINE_VERSION,m.id,item.id])}`,lineCode:`MATERIAL.${m.materialCode}`,category:'MATERIAL',description:m.materialCode,
      materialCode:m.materialCode,tradeCode:null,sourceMaterialLineIds:[m.id],quantity:quantity.decimal(options.quantityDecimalPlaces),quantityExact:quantity.exact(),quantityUnit:m.unit,
      procurement:m.purchase?{unit:m.purchase.unit,quantity:m.purchase.quantity,bagMassKg:m.purchase.bagMassKg}:null,status:'UNPRICED',reason:'COST_RATE_MISSING'};
    const candidates=book.entries.filter(e=>e.materialCode===m.materialCode && (e.assemblyId===undefined||e.assemblyId===item.assemblyId) && (e.specificationId===undefined||e.specificationId===item.specificationId));
    const matches=candidates.filter(e=>e.mode==='PHYSICAL'?e.unit===m.unit:
      m.purchase!==null&&e.unit===m.purchase.unit&&(e.unit!=='bag'||(m.purchase.bagMassKg!==null&&R(e.bagMassKg!).cmp(R(m.purchase.bagMassKg))===0)));
    if(matches.length>1)throw new CostError('RATE_MATCH_AMBIGUOUS','Multiple rates match one material requirement');
    const rate=matches[0];
    if(rate){
      const pricing=rate.mode==='PHYSICAL'?quantity:R(m.purchase!.quantity);
      if(rate.mode==='PURCHASE'){
        const equivalent=rate.unit==='bag'?pricing.mul(R(rate.bagMassKg!)):pricing;
        if(equivalent.cmp(quantity)<0)throw new CostError('COST_CALCULATION_FAILED','Purchase quantity is below physical requirement');
        warn('COST_PROCUREMENT_ROUNDING_USED',line.id);
      }
      const amount=pricing.mul(R(rate.rate));Object.assign(line,{status:'PRICED',reason:null,pricingQuantity:pricing.decimal(options.quantityDecimalPlaces),pricingQuantityExact:pricing.exact(),pricingUnit:rate.unit,unitRate:rate.rate,
        baseAmount:moneyString(amount),baseAmountExact:amount.exact(),rateProvenance:{rateBookId:book.id,rateBookVersion:book.version,rateBookHash:bookHash,rateEntryCode:rate.code}});
    }else{if(candidates.length)line.reason='COST_RATE_VARIANT_MISMATCH';warn(line.reason!,line.id);}
    if(item.status==='PARTIAL')warn('COST_PARTIAL_UPSTREAM_QUANTITY',line.id);
    lines.push(line);
  }
  for(const item of source.items){
    const unit=item.basis.unit==='mm2'?'m2':item.basis.unit==='mm3'?'m3':'each';
    const quantity=R(item.basis.value).div(R(item.basis.unit==='mm2'?'1000000':item.basis.unit==='mm3'?'1000000000':'1'));
    const rule=policy.laborRules.find(r=>r.assemblyId===item.assemblyId&&r.layerId===item.layerId);
    const line:BoqLine={...common(item),id:`labor:${costHash([COST_ENGINE_VERSION,item.id,item.layerId])}`,lineCode:`LABOR.${rule?.tradeCode??'NOT_EVALUATED'}`,category:'LABOR',description:rule?.tradeCode??'Labor not evaluated',
      materialCode:null,tradeCode:rule?.tradeCode??null,sourceMaterialLineIds:[],quantity:quantity.decimal(options.quantityDecimalPlaces),quantityExact:quantity.exact(),quantityUnit:unit,procurement:null,status:'NOT_EVALUATED',reason:'COST_LABOR_NOT_EVALUATED'};
    if(rule && item.status!=='NOT_EVALUATED'){
      if(rule.basisUnit!==unit)throw new CostError('COST_POLICY_INVALID','Labor rule unit does not match authoritative basis');
      const pricing=rule.mode==='DIRECT'?quantity:quantity.mul(R(rule.hoursPerUnit));const rate=rule.mode==='DIRECT'?rule.unitRate:rule.hourlyRate;
      const amount=pricing.mul(R(rate));Object.assign(line,{status:'PRICED',reason:null,pricingQuantity:pricing.decimal(options.quantityDecimalPlaces),pricingQuantityExact:pricing.exact(),pricingUnit:rule.mode==='DIRECT'?unit:'hour',
        unitRate:rate,baseAmount:moneyString(amount),baseAmountExact:amount.exact(),laborRuleId:rule.id});
    }else warn('COST_LABOR_NOT_EVALUATED',line.id);
    lines.push(line);
  }
  lines.sort((a,b)=>compare(a.id,b.id));
  const sum=(ls:BoqLine[])=>ls.reduce((s,l)=>s.add(R(l.baseAmount??'0')),R('0'));
  const material=sum(lines.filter(l=>l.category==='MATERIAL')),labor=sum(lines.filter(l=>l.category==='LABOR')),direct=material.add(labor);
  let running=direct;const adjustments:BoqCostReport['adjustments']=[];
  for(const rule of policy.adjustments){
    const basis=rule.basis==='MATERIAL'?material:rule.basis==='LABOR'?labor:rule.basis==='DIRECT'?direct:running;
    const amount=rule.kind==='PERCENT'?basis.mul(R(rule.value)).div(R('100')):R(rule.value).mul(R(rule.kind==='FIXED_DEDUCT'?'-1':'1'));
    const rounded=moneyString(amount);running=running.add(R(rounded));
    if(running.n<0n)throw new CostError('COST_POLICY_INVALID','Deduction exceeds priced running subtotal');
    adjustments.push({id:`adjustment:${rule.code}`,category:'ADJUSTMENT',rule,basisAmount:moneyString(basis),amount:rounded,amountExact:amount.exact()});warn('COST_ADJUSTMENT_APPLIED',`adjustment:${rule.code}`);
  }
  const priced=lines.filter(l=>l.status==='PRICED').length;
  const complete=lines.length>0&&priced===lines.length&&source.summary.status==='EVALUATED'&&source.coverage.every(c=>c.status==='EVALUATED')&&lines.every(l=>l.upstreamStatus==='EVALUATED');
  const coverage=priced===0?'NOT_PRICED':complete?'FULLY_PRICED':'PARTIALLY_PRICED';
  const groupMap=new Map<string,BoqCostReport['groups'][number]>();
  for(const line of lines)for(const [dimension,key] of [['category',line.category],['material',line.materialCode],['level',line.levelId],['assembly',line.assemblyId],['specification',line.specificationId],['trade',line.tradeCode]] as const){
    const keyId=JSON.stringify([dimension,key]);let g=groupMap.get(keyId);
    if(!g){if(groupMap.size>=COST_LIMITS.groups)throw new CostError('COST_RESOURCE_LIMIT','Group limit exceeded');g={dimension,key,lineIds:[],pricedAmount:'0.00',unpricedCount:0};groupMap.set(keyId,g);}
    g.lineIds.push(line.id);g.pricedAmount=moneyString(R(g.pricedAmount).add(R(line.baseAmount??'0')));if(line.status!=='PRICED')g.unpricedCount++;
  }
  const report={engineVersion:COST_ENGINE_VERSION,source:{constructionEngineVersion:source.engineVersion,takeoffEngineVersion:source.takeoffEngineVersion,measurementPolicyVersion:source.measurementPolicyVersion,
    recipePack:source.recipePack,upstreamStatus:source.summary.status},rateBook:book,rateBookHash:bookHash,costingPolicy:policy,costingPolicyHash:policyHash,currency:book.currency,region:book.region,options,
    boqLines:lines,unpricedLineIds:lines.filter(l=>l.status!=='PRICED').map(l=>l.id),subtotals:{material:moneyString(material),labor:moneyString(labor),direct:moneyString(direct)},adjustments,
    finalTotals:{pricedSubtotal:moneyString(direct),adjustmentsOnPricedSubtotal:moneyString(running.sub(direct)),pricedGrandTotal:moneyString(running),completeTotalAvailable:complete,completeRepresentedScopeTotal:complete?moneyString(running):null},coverage,
    groups:[...groupMap.values()].sort((a,b)=>compare(JSON.stringify([a.dimension,a.key]),JSON.stringify([b.dimension,b.key]))),warnings:warnings.sort((a,b)=>compare(`${a.code}:${a.lineId??''}`,`${b.code}:${b.lineId??''}`)),
    assumptions:['Physical pricing uses final exact upstream quantities; purchase pricing uses upstream purchase counts.','Money rounds half-up per line to two minor digits; subtotals sum emitted rounded lines.','Labor consumes the stated upstream basis once per calculation layer; no geometry is remeasured.','Totals cover represented priced work only; excluded scopes are not a complete project estimate.'],
    excludedScopes:['EQUIPMENT','TRANSPORT','UNREPRESENTED_STRUCTURAL_WORK','REINFORCEMENT','FOUNDATIONS','MEP']};
  boundedJson(report,COST_LIMITS.reportBytes);return BoqCostReportSchema.parse(report);
}
