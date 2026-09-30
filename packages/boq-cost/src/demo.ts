import { normalizeRateBook,normalizeCostingPolicy,type RateBookInput } from './contracts.js';
const entries:RateBookInput['entries']=[
  {code:'CEMENT_BAG_50',materialCode:'CEMENT',mode:'PURCHASE',unit:'bag',bagMassKg:'50',rate:'400',provenance:'Synthetic demonstration'},
  ...([['SAND','m3','1000'],['COARSE_AGGREGATE','m3','1200'],['READY_MIX_CONCRETE','m3','5000'],['FIRED_CLAY_BRICK','piece','10'],['CONCRETE_BLOCK','piece','40'],['AAC_BLOCK','piece','50'],['FLOOR_TILE','piece','100'],['PAINT','l','200'],['PRIMER','l','100'],['PUTTY','kg','20'],['DOOR_UNIT','each','3000'],['WINDOW_UNIT','each','2000']] as const).map(([materialCode,unit,rate])=>({code:materialCode,materialCode,mode:unit==='piece'||unit==='each'?'PURCHASE' as const:'PHYSICAL' as const,unit,rate,provenance:'Synthetic demonstration'})),
];
export function sampleRateBook(version:'1'|'2'='1') {return normalizeRateBook({id:`sample-inr-v${version}`,version,region:{country:'IN',regionCode:'SYNTHETIC'},currency:'INR',minorUnits:2,
  source:{kind:'SYNTHETIC',description:'SAMPLE / SYNTHETIC — NOT CURRENT MARKET DATA'},entries:version==='1'?entries:entries.map(e=>({...e,rate:e.materialCode==='FLOOR_TILE'?'110':e.rate}))});}
export function sampleCostingPolicy(){return normalizeCostingPolicy({id:'sample-policy',version:'1',currency:'INR',rounding:'HALF_UP_LINE_MINOR_UNITS',physicalQuantity:'FINAL_EXACT',laborRules:[
  {id:'tile-install',assemblyId:'tile',layerId:'finish',tradeCode:'TILE_INSTALLER',basisUnit:'m2',mode:'PRODUCTIVITY',hoursPerUnit:'0.5',hourlyRate:'200',provenance:'SYNTHETIC demonstration; not a labor standard'},
  {id:'concrete-labor',assemblyId:'concrete',layerId:'structure',tradeCode:'GENERAL_LABOR',basisUnit:'m3',mode:'DIRECT',unitRate:'500',provenance:'SYNTHETIC demonstration'},
  {id:'door-install',assemblyId:'door',layerId:'component',tradeCode:'GENERAL_LABOR',basisUnit:'each',mode:'DIRECT',unitRate:'100',provenance:'SYNTHETIC demonstration'},
],adjustments:[{code:'OVERHEAD',label:'Synthetic overhead',category:'OVERHEAD',order:10,basis:'DIRECT',kind:'PERCENT',value:'10'},
{code:'CONTINGENCY',label:'Synthetic contingency',category:'CONTINGENCY',order:20,basis:'RUNNING',kind:'PERCENT',value:'5'}]});}
