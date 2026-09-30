import { describe,it,expect } from 'vitest';
import { Rational } from '@designflow/construction-calculations';
import { calculateBoqCost,costHash,CostError,normalizeRateBook,normalizeCostingPolicy,BoqCostReportSchema,moneyString,COST_LIMITS,sampleRateBook,sampleCostingPolicy } from '../src/index.js';
import { sourceFixture,bookFixture,policyFixture } from './fixtures.js';
const run=()=>calculateBoqCost(sourceFixture(),bookFixture(),policyFixture());
const material=(r:ReturnType<typeof run>)=>r.boqLines.find(l=>l.category==='MATERIAL')!;
function frozen<T>(v:T):T{if(v && typeof v==='object'){Object.freeze(v);Object.values(v).forEach(frozen);}return v;}
describe('deterministic BOQ cost arithmetic and contracts',()=>{
  it('prices 100 kg × 10 and 10 m² × 50 with traceable reconciled amounts',()=>{
    const r=run(),m=material(r);expect(m.baseAmount).toBe('1000.00');expect(r.subtotals).toEqual({material:'1000.00',labor:'500.00',direct:'1500.00'});
    expect(r.coverage).toBe('FULLY_PRICED');expect(r.finalTotals.completeRepresentedScopeTotal).toBe('1500.00');
    expect(m.sourceMaterialLineIds).toEqual(['cement-1']);expect(m.sourceTakeoffItemIds).toEqual(['basis-1']);expect(m.architecturalEntityIds).toEqual(['host','primary']);expect(m.rateProvenance?.rateEntryCode).toBe('CEMENT_KG');
  });
  it('uses 25 purchase bags for 1243 physical kg at 400/bag',()=>{
    const s=sourceFixture(),m=s.materials[0]!;m.final='1243';m.finalExact={numerator:'1243',denominator:'1'};m.purchase!.quantity='25';
    const r=calculateBoqCost(s,bookFixture([{code:'BAG',materialCode:'CEMENT',mode:'PURCHASE',unit:'bag',bagMassKg:'50',rate:'400',provenance:'SYNTHETIC'}]),policyFixture());
    expect(material(r)).toMatchObject({quantity:'1243',pricingQuantity:'25',pricingUnit:'bag',baseAmount:'10000.00'});
  });
  it('retains mismatched bag variants as unpriced and refuses arbitrary package conversion',()=>{
    const r=calculateBoqCost(sourceFixture(),bookFixture([{code:'BAG',materialCode:'CEMENT',mode:'PURCHASE',unit:'bag',bagMassKg:'25',rate:'200',provenance:'SYNTHETIC'}]),policyFixture());
    expect(material(r)).toMatchObject({status:'UNPRICED',reason:'COST_RATE_VARIANT_MISMATCH',baseAmount:null});
    expect(()=>bookFixture([{code:'TILE_BOX',materialCode:'FLOOR_TILE',mode:'PURCHASE',unit:'bag',bagMassKg:'25',rate:'200',provenance:'SYNTHETIC'}])).toThrow(CostError);
  });
  it.each([['SAND','m3','3','21.00'],['FLOOR_TILE','piece','117','819.00'],['DOOR_UNIT','each','2','14.00'],['PAINT','l','4','28.00']] as const)('prices %s in its exact supported unit', (code,unit,q,amount)=>{
    const s=sourceFixture(),m=s.materials[0]!;Object.assign(m,{materialCode:code,unit,final:q,finalExact:{numerator:q,denominator:'1'},purchase:unit==='piece'||unit==='each'?{unit,quantity:q,bagMassKg:null,theoreticalEquivalent:q,adjustedEquivalent:q}:null});
    const r=calculateBoqCost(s,bookFixture([{code,materialCode:code,mode:unit==='piece'||unit==='each'?'PURCHASE':'PHYSICAL',unit,rate:'7',provenance:'SYNTHETIC'}]),policyFixture());expect(material(r).baseAmount).toBe(amount);
  });
  it('prices explicit productivity: 10 m² × 0.5 hours/m² × 200/hour = 1000',()=>{
    const p=policyFixture();p.laborRules=[{id:'tile',assemblyId:'tile',layerId:'finish',tradeCode:'TILE_INSTALLER',basisUnit:'m2',mode:'PRODUCTIVITY',hoursPerUnit:'0.5',hourlyRate:'200',provenance:'SYNTHETIC'}];
    const r=calculateBoqCost(sourceFixture(),bookFixture(),p);expect(r.boqLines.find(l=>l.category==='LABOR')).toMatchObject({pricingQuantity:'5',pricingUnit:'hour',baseAmount:'1000.00'});
  });
  it('does not double count duplicate labor layers or duplicate authoritative items',()=>{
    const p=policyFixture();p.laborRules.push({...p.laborRules[0]!,id:'another'});expect(()=>normalizeCostingPolicy(p)).toThrow(CostError);
    const s=sourceFixture();s.items.push(s.items[0]!);expect(()=>calculateBoqCost(s,bookFixture(),policyFixture())).toThrow(CostError);
  });
  it('requires explicit labor with compatible upstream units',()=>{
    const p=policyFixture();p.laborRules=[];const r=calculateBoqCost(sourceFixture(),bookFixture(),p);expect(r.boqLines.find(l=>l.category==='LABOR')).toMatchObject({status:'NOT_EVALUATED',baseAmount:null});expect(r.finalTotals.completeTotalAvailable).toBe(false);
    const bad=policyFixture();bad.laborRules[0]!.basisUnit='m3';expect(()=>calculateBoqCost(sourceFixture(),bookFixture(),bad)).toThrow(CostError);
  });
  it('preserves missing materials with null prices and distinct partial/not-priced coverage',()=>{
    const s=sourceFixture();s.materials.push({...s.materials[0]!,id:'sand-1',materialCode:'SAND',unit:'m3',purchase:null});
    const r=calculateBoqCost(s,bookFixture(),policyFixture());expect(r.coverage).toBe('PARTIALLY_PRICED');expect(r.boqLines.find(l=>l.materialCode==='SAND')).toMatchObject({status:'UNPRICED',quantity:'100',baseAmount:null});expect(r.finalTotals.completeRepresentedScopeTotal).toBeNull();
    const p=policyFixture();p.laborRules=[];expect(calculateBoqCost(s,bookFixture([]),p).coverage).toBe('NOT_PRICED');
  });
  it('propagates partial quantities even when every represented line has a price',()=>{
    const s=sourceFixture();s.items[0]!.status='PARTIAL';s.summary.status='PARTIAL';const r=calculateBoqCost(s,bookFixture(),policyFixture());expect(r.coverage).toBe('PARTIALLY_PRICED');expect(material(r).upstreamStatus).toBe('PARTIAL');expect(r.finalTotals.completeTotalAvailable).toBe(false);
  });
  it.each([['1.005','1.01'],['2.675','2.68'],['0.0049','0.00'],['-1.005','-1.01']])('rounds exact %s half-up to %s', (input,expected)=>expect(moneyString(Rational.from(input))).toBe(expected));
  it('prices exact rationals rather than displayed rounded physical quantities',()=>{
    const s=sourceFixture();s.materials[0]!.final='0.333333';s.materials[0]!.finalExact={numerator:'1',denominator:'3'};
    const b=bookFixture();b.entries[0]!.rate='3000000';const r=calculateBoqCost(s,b,policyFixture(),{quantityDecimalPlaces:6});expect(material(r).baseAmount).toBe('1000000.00');expect(material(r).quantity).toBe('0.333333');
  });
  it('reconciles line rounding without hidden cents',()=>{
    const s=sourceFixture();s.materials[0]!.finalExact={numerator:'1',denominator:'1'};s.materials.push({...s.materials[0]!,id:'cement-2'});const b=bookFixture();b.entries[0]!.rate='1.005';const r=calculateBoqCost(s,b,policyFixture());expect(r.subtotals.material).toBe('2.02');
    const groups=r.groups.filter(g=>g.dimension==='category');expect(groups.find(g=>g.key==='MATERIAL')?.pricedAmount).toBe('2.02');expect(new Set(groups.flatMap(g=>g.lineIds)).size).toBe(r.boqLines.length);
  });
  it('orders overhead, contingency, synthetic charge and fixed deduction explicitly',()=>{
    const p=policyFixture();p.adjustments=[
      {code:'OVERHEAD',label:'Overhead',category:'OVERHEAD',order:10,basis:'DIRECT',kind:'PERCENT',value:'10'},
      {code:'CONTINGENCY',label:'Contingency',category:'CONTINGENCY',order:20,basis:'RUNNING',kind:'PERCENT',value:'5'},
      {code:'TEST_CHARGE',label:'Synthetic configured charge',category:'CHARGE',order:30,basis:'RUNNING',kind:'PERCENT',value:'10'},
      {code:'DEDUCTION',label:'Configured deduction',category:'ADJUSTMENT',order:40,basis:'RUNNING',kind:'FIXED_DEDUCT',value:'5'},
    ];const r=calculateBoqCost(sourceFixture(),bookFixture(),p);expect(r.adjustments.map(a=>a.amount)).toEqual(['150.00','82.50','173.25','-5.00']);expect(r.finalTotals.pricedGrandTotal).toBe('1900.75');
    p.adjustments.reverse();expect(calculateBoqCost(sourceFixture(),bookFixture(),p)).toEqual(r);
  });
  it('rejects excessive deductions and duplicate adjustment order',()=>{
    const p=policyFixture();p.adjustments=[{code:'D',label:'Deduct',category:'ADJUSTMENT',order:0,basis:'DIRECT',kind:'FIXED_DEDUCT',value:'100000'}];expect(()=>calculateBoqCost(sourceFixture(),bookFixture(),p)).toThrow(CostError);
    p.adjustments.push({...p.adjustments[0]!,code:'D2'});expect(()=>normalizeCostingPolicy(p)).toThrow(CostError);
  });
  it('rejects duplicate, ambiguous, negative, currency and unit-invalid rates',()=>{
    const b=bookFixture();b.entries.push({...b.entries[0]!,code:'OTHER'});expect(()=>normalizeRateBook(b)).toThrow(CostError);
    const ambiguous=bookFixture();ambiguous.entries.push({...ambiguous.entries[0]!,code:'SPECIFIC',assemblyId:'tile'});expect(()=>calculateBoqCost(sourceFixture(),ambiguous,policyFixture())).toThrowError(expect.objectContaining({code:'RATE_MATCH_AMBIGUOUS'}));
    for(const change of [{rate:'-1'},{unit:'bag'},{rate:'1e4'}])expect(()=>normalizeRateBook({...bookFixture(),entries:[{...bookFixture().entries[0],...change}]})).toThrow(CostError);
    expect(()=>calculateBoqCost(sourceFixture(),bookFixture(),{...policyFixture(),currency:'USD'})).toThrow(CostError);
  });
  it('rejects text that cannot be persisted as PostgreSQL JSONB while accepting valid Unicode',()=>{
    for(const label of ['bad\u0000label','bad\ud800label','bad\udc00label']){
      const p=policyFixture();p.laborRules[0]!.provenance=label;
      expect(()=>normalizeCostingPolicy(p)).toThrowError(expect.objectContaining({code:'COST_POLICY_INVALID'}));
    }
    const p=policyFixture();p.laborRules[0]!.provenance='मज़दूरी — explicit synthetic rule 🧱';
    expect(calculateBoqCost(sourceFixture(),bookFixture(),p).costingPolicy.laborRules[0]!.provenance).toBe(p.laborRules[0]!.provenance);
  });
  it('hashes changed book/policy content even under unchanged version strings',()=>{
    const original=run(),b=bookFixture(),p=policyFixture();b.entries[0]!.rate='11';p.laborRules[0]={...p.laborRules[0]!,mode:'DIRECT',unitRate:'51'};
    const changed=calculateBoqCost(sourceFixture(),b,p);expect(changed.rateBookHash).not.toBe(original.rateBookHash);expect(changed.costingPolicyHash).not.toBe(original.costingPolicyHash);expect(costHash(changed)).not.toBe(costHash(original));
  });
  it('is deterministic for frozen inputs, permutations, concurrent calls and JSON roundtrips',async()=>{
    const s=frozen(sourceFixture()),b=frozen(bookFixture()),p=frozen(policyFixture());const before=JSON.stringify([s,b,p]);
    const reports=await Promise.all(Array.from({length:8},async()=>calculateBoqCost(s,b,p)));for(const r of reports)expect(r).toEqual(reports[0]);expect(JSON.stringify([s,b,p])).toBe(before);
    expect(BoqCostReportSchema.parse(JSON.parse(JSON.stringify(reports[0])))).toEqual(reports[0]);
    const shuffled=structuredClone(s);shuffled.items.reverse();shuffled.materials.reverse();shuffled.sections.reverse();shuffled.coverage.reverse();expect(calculateBoqCost(shuffled,b,p)).toEqual(reports[0]);
  });
  it('bounds resources and rejects forged source relationships and purchase shortfalls',()=>{
    expect(()=>calculateBoqCost(sourceFixture(),{...bookFixture(),entries:Array(COST_LIMITS.entries+1).fill(bookFixture().entries[0])},policyFixture())).toThrowError(expect.objectContaining({code:'COST_RESOURCE_LIMIT'}));
    const tooManyRules={...policyFixture(),laborRules:Array(COST_LIMITS.rules+1).fill(policyFixture().laborRules[0])};
    expect(()=>calculateBoqCost(sourceFixture(),bookFixture(),tooManyRules)).toThrowError(expect.objectContaining({code:'COST_RESOURCE_LIMIT'}));
    const many=sourceFixture();many.materials=Array.from({length:5000},(_,i)=>({...many.materials[0]!,id:`material-${i}`}));
    const rates={...bookFixture(),entries:Array.from({length:500},(_,i)=>({...bookFixture().entries[0]!,code:`rate-${i}`,assemblyId:`assembly-${i}`}))};
    expect(()=>calculateBoqCost(many,rates,policyFixture())).toThrowError(expect.objectContaining({code:'COST_RESOURCE_LIMIT'}));
    expect(()=>calculateBoqCost(sourceFixture(),{x:'x'.repeat(COST_LIMITS.bookBytes)},policyFixture())).toThrowError(expect.objectContaining({code:'COST_RESOURCE_LIMIT'}));
    const s=sourceFixture();s.materials[0]!.calculationItemId='absent';expect(()=>calculateBoqCost(s,bookFixture(),policyFixture())).toThrow(CostError);
    const short=sourceFixture();short.materials[0]!.purchase!.quantity='1';expect(()=>calculateBoqCost(short,sampleRateBook(),policyFixture())).toThrow(CostError);
  });
  it('labels source-controlled samples explicitly and validates both versions',()=>{
    expect(sampleRateBook().source).toMatchObject({kind:'SYNTHETIC'});expect(sampleRateBook().source.description).toContain('NOT CURRENT MARKET DATA');expect(sampleRateBook('2').id).not.toBe(sampleRateBook().id);expect(()=>normalizeCostingPolicy(sampleCostingPolicy())).not.toThrow();
  });
});
