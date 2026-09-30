import { calculateConstruction,type ConstructionReport,type Material } from '@designflow/construction-calculations';
import { basis,specification } from '../../construction-calculations/tests/fixtures.js';
import { normalizeCostingPolicy,normalizeRateBook,type RateBookInput } from '../src/index.js';
export function sourceFixture():ConstructionReport {
  const source=calculateConstruction(basis('FLOOR_FINISH_BASE_AREA','10000000'),specification());
  source.coverage=source.coverage.map(c=>({...c,status:'EVALUATED'}));source.summary.status='EVALUATED';source.warnings=[];source.summary.warningCount=0;
  const item=source.items[0]!;item.status='EVALUATED';
  const material:Material={id:'cement-1',calculationItemId:item.id,coatingId:null,materialCode:'CEMENT',unit:'kg',theoretical:'100',wastage:'0',final:'100',theoreticalExact:{numerator:'100',denominator:'1'},finalExact:{numerator:'100',denominator:'1'},purchase:{unit:'bag',quantity:'2',bagMassKg:'50',theoreticalEquivalent:'2',adjustedEquivalent:'2'}};
  source.materials=[material];source.summary.materialCount=1;source.summary.totals=[];source.sections=[];return source;
}
export function bookFixture(entries:RateBookInput['entries']=[{code:'CEMENT_KG',materialCode:'CEMENT',mode:'PHYSICAL',unit:'kg',rate:'10',provenance:'SYNTHETIC test'}]){
  return normalizeRateBook({id:'synthetic-fixture',version:'1',region:{country:'IN',regionCode:'TEST'},currency:'INR',minorUnits:2,source:{kind:'SYNTHETIC',description:'SYNTHETIC / NOT CURRENT MARKET DATA'},entries});
}
export function policyFixture(){return normalizeCostingPolicy({id:'fixture',version:'1',currency:'INR',rounding:'HALF_UP_LINE_MINOR_UNITS',physicalQuantity:'FINAL_EXACT',laborRules:[
  {id:'tile-labor',assemblyId:'tile',layerId:'finish',tradeCode:'TILE_INSTALLER',basisUnit:'m2',mode:'DIRECT',unitRate:'50',provenance:'SYNTHETIC test'}],adjustments:[]});}
