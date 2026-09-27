import { calculateQuantityTakeoff, type QuantityTakeoffReport, type QuantityItem } from '@designflow/quantity-takeoff';
import { authored } from '../../blueprint-qa/tests/fixtures.js';
import type { ConstructionSpecificationInput } from '../src/index.js';
export const mix = { dryVolumeFactor:'1.5',cementParts:'1',sandParts:'3',cementBulkDensityKgPerM3:'1000',bagMassKg:'50' };
export function specification(): ConstructionSpecificationInput {
  return {id:'test-spec',version:'1',recipePack:{id:'construction-recipes',version:'1'},assemblies:[
    {id:'concrete',kind:'concrete',wastagePercent:'5',mode:{type:'READY_MIX_VOLUME_ONLY'}},
    {id:'tile',kind:'flooring',wastagePercent:'10',tileLengthMm:500,tileWidthMm:500},
    {id:'door',kind:'component',wastagePercent:'0',materialCode:'DOOR_UNIT'},
  ],assignments:[
    {id:'slab',basis:'FLOOR_PLATE_VOLUME',assemblyId:'concrete',layerId:'structure',selector:{kind:'default'}},
    {id:'floor',basis:'FLOOR_FINISH_BASE_AREA',assemblyId:'tile',layerId:'finish',selector:{kind:'default'}},
    {id:'doors',basis:'DOOR_COUNT',assemblyId:'door',layerId:'component',selector:{kind:'default'}},
  ]};
}
export function basis(itemCode: QuantityItem['itemCode'], value: string, thicknessMm: number|null = null): QuantityTakeoffReport {
  const report = calculateQuantityTakeoff(authored());
  const unit = itemCode.endsWith('VOLUME')?'mm3':itemCode.endsWith('COUNT')?'each':'mm2';
  const item: QuantityItem = {id:'basis-1',itemCode,category:unit==='mm3'?'WALL':unit==='each'?'OPENING':'SPACE',
    quantity:{value,unit,dimension:unit==='mm3'?'VOLUME':unit==='each'?'COUNT':'AREA',display:{value:'0',unit:unit==='mm3'?'m3':unit==='each'?'each':'m2'}},
    sourceEntityIds:['primary','host'],levelId:'level',specificationId:'spec',classification:'internal',thicknessMm,evidence:{},assumptions:[],status:'EVALUATED'};
  report.items=[item];report.summary.itemCount=1;report.summary.totals=[];report.sections=[];
  return report;
}
