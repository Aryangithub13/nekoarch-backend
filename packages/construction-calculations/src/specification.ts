import { z } from 'zod';
import { R } from './precision.js';
export const CONSTRUCTION_ENGINE_VERSION = 'construction-calculation-v1';
export const CONSTRUCTION_LIMITS = { takeoffBytes: 10_000_000, specificationBytes: 131072, reportBytes: 16_777_216,
  assemblies: 128, assignments: 512, calculations: 20000, materials: 40000, warnings: 20000, matchingWork: 1_000_000, sections: 10000 } as const;
export class ConstructionError extends Error {
  constructor(readonly code: 'CONSTRUCTION_SPEC_INVALID'|'CONSTRUCTION_RECIPE_NOT_FOUND'|'CONSTRUCTION_RESOURCE_LIMIT'|'CONSTRUCTION_CALCULATION_FAILED'|'TAKEOFF_NOT_ACCEPTED', message: string) {
    super(message); this.name='ConstructionError';
  }
}
export const compare = (a: string,b: string) => a<b ? -1 : a>b ? 1 : 0;
export const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const nonnegative = z.string().max(20).regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/)
  .refine(v=>R(v).cmp(R('1000000'))<=0,'Parameter exceeds maximum').transform(v=>R(v).decimal(6));
const positive = nonnegative.refine(v=>R(v).cmp(R('0'))>0,'Must be positive');
const percent = nonnegative.refine(v=>R(v).cmp(R('100'))<=0,'Wastage must be 0–100 percent');
const mm = z.number().int().min(1).max(10000);
export const MixSchema = z.object({ dryVolumeFactor: positive, cementParts: positive, sandParts: positive,
  cementBulkDensityKgPerM3: positive, bagMassKg: positive }).strict();
const base = { id: identifier, wastagePercent: percent };
export const AssemblySchema = z.discriminatedUnion('kind',[
  z.object({ ...base, kind:z.literal('masonry'), materialCode:z.enum(['FIRED_CLAY_BRICK','CONCRETE_BLOCK','AAC_BLOCK']),
    unitLengthMm:mm,unitHeightMm:mm,unitDepthMm:mm, longitudinalJointMm:nonnegative,bedJointMm:nonnegative,
    unitForm:z.literal('SOLID_RECTANGULAR'), mortar:MixSchema.optional() }).strict(),
  z.object({ ...base,kind:z.literal('plaster'),thicknessMm:mm,sides:z.union([z.literal(1),z.literal(2)]),mix:MixSchema }).strict(),
  z.object({ ...base,kind:z.literal('flooring'),tileLengthMm:mm,tileWidthMm:mm }).strict(),
  z.object({ ...base,kind:z.literal('paint'),sides:z.union([z.literal(1),z.literal(2)]), coatings:z.array(z.object({
    id:identifier,materialCode:z.enum(['PAINT','PRIMER','PUTTY']),coats:z.number().int().min(1).max(10),coverageM2PerUnit:positive,
  }).strict()).min(1).max(8) }).strict(),
  z.object({ ...base,kind:z.literal('concrete'),mode:z.discriminatedUnion('type',[
    z.object({type:z.literal('READY_MIX_VOLUME_ONLY')}).strict(),
    z.object({type:z.literal('NOMINAL_VOLUMETRIC_RECIPE'),mix:MixSchema.extend({coarseAggregateParts:positive}).strict()}).strict(),
  ]) }).strict(),
  z.object({ ...base,kind:z.literal('component'),materialCode:z.enum(['DOOR_UNIT','WINDOW_UNIT']) }).strict(),
]);
export type Assembly = z.infer<typeof AssemblySchema>;
export const SUPPORTED_BASES = ['WALL_SEGMENT_NET_VOLUME','WALL_SINGLE_FACE_NET_AREA','FLOOR_FINISH_BASE_AREA',
  'FLOOR_PLATE_VOLUME','ROOF_VOLUME','COLUMN_GEOMETRIC_VOLUME','DOOR_COUNT','WINDOW_COUNT'] as const;
export const BasisSchema = z.enum(SUPPORTED_BASES);
export const SelectorSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('entity'),value:z.string().min(1).max(200)}).strict(),
  z.object({kind:z.literal('specification'),value:z.string().min(1).max(200)}).strict(),
  z.object({kind:z.literal('classification'),value:z.string().min(1).max(200)}).strict(),
  z.object({kind:z.literal('level'),value:z.string().min(1).max(200)}).strict(),
  z.object({kind:z.literal('default')}).strict(),
]);
export const ConstructionSpecificationSchema = z.object({ id:identifier,version:identifier,
  recipePack:z.object({id:identifier,version:identifier}).strict(),
  allowMultipleLayers:z.boolean().default(false),
  assemblies:z.array(AssemblySchema).max(CONSTRUCTION_LIMITS.assemblies),
  assignments:z.array(z.object({ id:identifier,basis:BasisSchema,assemblyId:identifier,layerId:identifier,selector:SelectorSchema }).strict()).max(CONSTRUCTION_LIMITS.assignments),
}).strict().superRefine((s,ctx)=>{
  for(const values of [s.assemblies.map(a=>a.id),s.assignments.map(a=>a.id)]) if(new Set(values).size!==values.length) ctx.addIssue({code:'custom',message:'Duplicate identifiers'});
  const assemblies=new Map(s.assemblies.map(a=>[a.id,a]));
  for(const a of s.assemblies) if(a.kind==='paint' && new Set(a.coatings.map(c=>c.id)).size!==a.coatings.length) ctx.addIssue({code:'custom',message:'Duplicate coating identifiers'});
  for(const a of s.assignments) {
    const assembly=assemblies.get(a.assemblyId);
    if(!assembly) ctx.addIssue({code:'custom',message:'Unknown assembly reference'});
    else if(!basesFor(assembly).includes(a.basis)) ctx.addIssue({code:'custom',message:'Assembly is incompatible with quantity basis'});
  }
}).transform(s=>({...s,assemblies:s.assemblies.map(a=>a.kind==='paint'?{...a,coatings:[...a.coatings].sort((a,b)=>compare(a.id,b.id))}:a).sort((a,b)=>compare(a.id,b.id)),
  assignments:[...s.assignments].sort((a,b)=>compare(a.id,b.id))}));
export type ConstructionSpecification = z.infer<typeof ConstructionSpecificationSchema>;
export type ConstructionSpecificationInput = z.input<typeof ConstructionSpecificationSchema>;
export const ConstructionOptionsSchema = z.object({ quantityDecimalPlaces:z.number().int().min(6).max(12).default(9) }).strict();
export type ConstructionOptions = z.input<typeof ConstructionOptionsSchema>;
export function basesFor(a: Assembly): readonly string[] {
  switch(a.kind) {
    case 'masonry': return ['WALL_SEGMENT_NET_VOLUME'];
    case 'paint': case 'plaster': return ['WALL_SINGLE_FACE_NET_AREA'];
    case 'flooring': return ['FLOOR_FINISH_BASE_AREA'];
    case 'concrete': return ['FLOOR_PLATE_VOLUME','ROOF_VOLUME','COLUMN_GEOMETRIC_VOLUME'];
    case 'component': return [a.materialCode==='DOOR_UNIT'?'DOOR_COUNT':'WINDOW_COUNT'];
  }
}
export function boundedJson(value: unknown, max: number) {
  let encoded: string;
  try { encoded=JSON.stringify(value); if(encoded===undefined) throw new Error(); }
  catch { throw new ConstructionError('CONSTRUCTION_SPEC_INVALID','Expected JSON-safe input'); }
  let bytes=0;
  for(const c of encoded) { const n=c.codePointAt(0)!; bytes+=n<128?1:n<2048?2:n<65536?3:4; if(bytes>max) throw new ConstructionError('CONSTRUCTION_RESOURCE_LIMIT','JSON size limit exceeded'); }
}
export function normalizeConstructionSpecification(input: unknown) {
  boundedJson(input,CONSTRUCTION_LIMITS.specificationBytes);
  const parsed=ConstructionSpecificationSchema.safeParse(input);
  if(!parsed.success) throw new ConstructionError('CONSTRUCTION_SPEC_INVALID','Invalid construction specification');
  return parsed.data;
}
