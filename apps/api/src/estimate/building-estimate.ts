import { polygonAreaMm2, segmentLengthMm, type BuildingModelV2 } from '@designflow/shared';

/**
 * Concept-stage engineering and cost estimate computed directly from a generated building model.
 *
 * Structure: preliminary RCC frame sizing with IS 456:2000 / IS 875 (Part 1, 2) rules of thumb (span/depth ratios,
 * short-column axial capacity 0.4 fck Ac + 0.67 fy Asc, isolated footings on an assumed safe bearing capacity).
 * Quantities: concrete, reinforcement, masonry, plaster, flooring, wall tiling, painting, waterproofing, doors and
 * windows measured from the model geometry. Cost: itemised BOQ at illustrative 2026 Indian market rates by quality tier
 * and a city factor. This is a planning estimate, not a structural design or a tender: a licensed structural engineer
 * and quantity surveyor must verify before construction.
 */
export type Tier = 'economy' | 'standard' | 'premium' | 'luxury';
export interface EstimateOptions { tier: Tier; city?: string | undefined; buildingType?: string | undefined; budgetInr?: number | undefined; soilBearingKnM2?: number }
export interface BoqLine { code: string; category: string; item: string; unit: string; quantity: number; rateInr: number; amountInr: number }
export interface BuildingEstimate {
  schemaVersion: 1; basis: string; currency: 'INR';
  areas: { plotM2: number; footprintM2: number; builtUpM2: number; builtUpSqft: number; carpetM2: number; carpetSqft: number; floors: number; groundCoveragePct: number; far: number };
  structure: {
    system: string; concreteGrade: string; steelGrade: string; liveLoadKnM2: number; deadLoadKnM2: number; factoredLoadKnM2: number;
    slab: { thicknessMm: number; maxSpanM: number; rule: string };
    beams: { sizeMm: string; maxSpanM: number; rule: string };
    columns: { count: number; sizeMm: string; maxFactoredLoadKn: number; rule: string };
    footings: { type: string; sizeM: string; depthM: number; soilBearingKnM2: number; rule: string };
    stair: { risers: number; riserMm: number; treadMm: number; widthMm: number; check: string } | null;
  };
  quantities: { concreteM3: number; steelKg: number; steelTonnes: number; bricks: number; cementBags: number; sandM3: number; aggregateM3: number; plasterM2: number; flooringM2: number; wallTileM2: number; paintM2: number; waterproofingM2: number; doors: number; windows: number; windowAreaM2: number; excavationM3: number };
  boq: BoqLine[];
  summary: { subtotalInr: number; contractorMarginInr: number; contingencyInr: number; gstInr: number; totalInr: number; perSqftInr: number; perM2Inr: number; rangeInr: [number, number]; cityFactor: number; byCategory: { category: string; amountInr: number; sharePct: number }[] };
  budget: { budgetInr: number; differenceInr: number; status: 'WITHIN' | 'TIGHT' | 'OVER' } | null;
  timeline: { months: number; phases: { phase: string; weeks: number }[] };
  assumptions: string[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const METRO = /mumbai|delhi|gurgaon|gurugram|noida|bengaluru|bangalore|pune|hyderabad|chennai|thane|navi mumbai|kolkata/i;
const TIER2 = /ahmedabad|jaipur|lucknow|chandigarh|mohali|kochi|cochin|coimbatore|indore|surat|vadodara|nagpur|bhopal|visakhapatnam|vizag|goa|dehradun|mysuru|mysore|bhubaneswar/i;
export const cityFactor = (city?: string) => !city ? 1 : METRO.test(city) ? 1.15 : TIER2.test(city) ? 1.0 : 0.92;
/** Illustrative 2026 rates (INR) by tier; finishes vary most, structure least. */
const RATES = {
  excavation: 380, pcc: 6200, rcc: 9800, steel: 84, brick230: 7400, partition: 1050, plasterInt: 46, plasterExt: 72, waterproof: 720, stairRailing: 4200,
  flooring: { economy: 1150, standard: 1650, premium: 2900, luxury: 5200 },
  wallTile: { economy: 950, standard: 1250, premium: 2100, luxury: 3600 },
  paintInt: { economy: 140, standard: 185, premium: 260, luxury: 380 }, paintExt: { economy: 170, standard: 220, premium: 300, luxury: 420 },
  doorMain: { economy: 28000, standard: 45000, premium: 85000, luxury: 160000 }, doorInt: { economy: 11000, standard: 17000, premium: 28000, luxury: 48000 },
  window: { economy: 4800, standard: 7600, premium: 11500, luxury: 18000 },
  bathroom: { economy: 65000, standard: 110000, premium: 210000, luxury: 380000 }, kitchen: { economy: 45000, standard: 85000, premium: 180000, luxury: 350000 },
  electrical: { economy: 480, standard: 650, premium: 950, luxury: 1450 }, plumbingGeneral: { economy: 160, standard: 220, premium: 320, luxury: 450 },
  falseCeiling: { economy: 0, standard: 0, premium: 1100, luxury: 1700 }, elevation: { economy: 250, standard: 450, premium: 900, luxury: 1600 },
};
const LIVE_LOAD: Record<string, number> = { house: 2.0, villa: 2.0, apartment: 2.0, office: 3.0, cafe: 4.0, restaurant: 4.0, retail: 4.0, clinic: 3.0, school: 3.0, community: 5.0, studio: 3.0, 'mixed-use': 4.0 };

export function estimateBuilding(model: BuildingModelV2, o: EstimateOptions): BuildingEstimate {
  const tier = o.tier, f = cityFactor(o.city);
  const storeys = model.levels.filter(l => l.kind === 'storey');
  const floors = Math.max(1, storeys.length);
  const H = (storeys[0]?.floorToFloorHeightMm ?? 3000) / 1000;
  const area = (ring: Parameters<typeof polygonAreaMm2>[0]) => Number(polygonAreaMm2(ring)) / 1e6;
  const footprint = storeys[0] ? area(storeys[0].boundary) : 0;
  const builtUp = storeys.reduce((n, l) => n + area(l.boundary), 0);
  const plot = model.site ? area(model.site.boundary) : footprint;
  const carpet = model.spaces.reduce((n, s) => n + area(s.boundary), 0) * 0.93; // centerline areas less wall half-thickness
  const slabT = model.slabs.find(s => s.kind === 'floor')?.thicknessMm ?? 150;
  const ext = model.walls.filter(w => w.classification === 'exterior'), int = model.walls.filter(w => w.classification !== 'exterior');
  const len = (ws: typeof model.walls) => ws.reduce((n, w) => n + segmentLengthMm(w.path) / 1000, 0);
  const extLen = len(ext), intLen = len(int);
  const extT = (ext[0]?.thicknessMm ?? 230) / 1000, intT = (int[0]?.thicknessMm ?? 115) / 1000;
  const wallH = H - slabT / 1000;
  const openings = model.openings, doors = openings.filter(x => x.kind === 'door' || x.kind === 'opening'), windows = openings.filter(x => x.kind === 'window');
  const openArea = (xs: typeof openings) => xs.reduce((n, x) => n + x.widthMm * x.heightMm / 1e6, 0);
  const extOpen = openings.filter(x => ext.some(w => w.id === x.wallId)), intOpen = openings.filter(x => int.some(w => w.id === x.wallId));
  const wet = model.spaces.filter(s => s.classification === 'bathroom');
  const kitchens = model.spaces.filter(s => /kitchen/i.test(s.classification));

  // Spans: the longest short side of any room governs slab thickness; the longest room side governs beams.
  const spans = model.spaces.map(s => { const xs = s.boundary.map(p => p.x), zs = s.boundary.map(p => p.z); const a = (Math.max(...xs) - Math.min(...xs)) / 1000, b = (Math.max(...zs) - Math.min(...zs)) / 1000; return { short: Math.min(a, b), long: Math.max(a, b) }; });
  const slabSpan = Math.max(3, ...spans.filter(s => s.long < 12).map(s => s.short));
  const beamSpan = Math.min(7.5, Math.max(3.5, ...spans.map(s => Math.min(s.long, 7.5))));
  const slabMm = Math.max(125, Math.ceil(slabSpan * 1000 / 32 / 25) * 25); // two-way slab, L/d ≈ 32 (IS 456 cl. 24.1 note)
  const beamDepth = Math.max(380, Math.ceil(beamSpan * 1000 / 12 / 50) * 50), beamWidth = 230; // L/D ≈ 12 for continuous beams
  const live = LIVE_LOAD[o.buildingType ?? 'house'] ?? 2.0;
  const dead = round(25 * slabMm / 1000 + 1.5 + 1.0 + 0.8, 2); // slab self-weight + finishes + partitions + beam allowance
  const wu = round(1.5 * (dead + live), 2);
  // Columns: modelled ones when present, otherwise a frame grid of about one column per 11 m² of footprint (3.3 m bays) plus corners.
  const colCount = Math.max(4, new Set(model.columns.map(c => c.id.replace(/^column-\d+-/, ''))).size || Math.round(footprint / 11) + 4);
  const tributary = footprint / colCount * 1.25; // edge/interior imbalance allowance
  const pu = round(wu * tributary * floors + 1.5 * (extT * wallH * 20 * Math.sqrt(tributary)) * floors, 1); // + wall line load share
  const capacity = 0.4 * 25 * 0.99 + 0.67 * 500 * 0.01; // N/mm², M25, Fe500, 1 % steel
  const agReq = pu * 1000 / capacity; // mm²
  const colB = 230, colD = Math.max(300, Math.ceil(agReq / colB / 75) * 75);
  const colSize = colD > 600 ? (() => { const s = Math.ceil(Math.sqrt(agReq) / 50) * 50; return `${s} x ${s}`; })() : `${colB} x ${colD}`;
  const sbc = o.soilBearingKnM2 ?? 150;
  const service = pu / 1.5 * 1.1; // service load + 10 % footing self-weight
  const footSide = Math.max(1.2, Math.ceil(Math.sqrt(service / sbc) * 10) / 10);
  const footDepth = floors <= 2 ? 1.5 : floors <= 4 ? 1.8 : 2.1;

  const stairs = model.stairs[0];
  const stair = stairs ? { risers: stairs.riserHeightsMm.length, riserMm: Math.round(stairs.riseMm / stairs.riserHeightsMm.length), treadMm: stairs.treadDepthMm, widthMm: stairs.widthMm,
    check: `2R + T = ${2 * Math.round(stairs.riseMm / stairs.riserHeightsMm.length) + stairs.treadDepthMm} mm (comfort range 550-700 mm); riser ≤ 190 mm and tread ≥ 250 mm for residential stairs (NBC 2016 Part 4)` } : null;

  // Quantities.
  const slabConcrete = builtUp * slabMm / 1000 + footprint * slabMm / 1000; // floor plates incl. roof
  const beamLen = (extLen + intLen * 0.6) ; // beams under exterior walls and main interior lines, all floors
  const beamConcrete = beamLen * beamWidth / 1000 * (beamDepth - slabMm) / 1000;
  const colSide = colSize.split(' x ').map(Number);
  const colConcrete = colCount * (colSide[0]! / 1000) * (colSide[1]! / 1000) * (H * floors + footDepth);
  const footConcrete = colCount * footSide * footSide * 0.45;
  const plinthBeam = len(ext.filter(w => w.levelId === storeys[0]?.id)) * 0.23 * 0.45 + len(int.filter(w => w.levelId === storeys[0]?.id)) * 0.6 * 0.23 * 0.4;
  const stairConcrete = model.stairs.reduce((n, s) => n + (s.runMm / 1000) * (s.widthMm / 1000) * 0.32 + (s.landings.length * 1.1 * s.widthMm / 1000 * 2 * 0.15), 0);
  const concrete = slabConcrete + beamConcrete + colConcrete + footConcrete + plinthBeam + stairConcrete;
  const steel = slabConcrete * 85 + beamConcrete * 135 + colConcrete * 190 + footConcrete * 65 + plinthBeam * 110 + stairConcrete * 95;
  const pcc = colCount * (footSide + 0.15) ** 2 * 0.1 + footprint * 0.075;
  const excavation = colCount * (footSide + 0.6) ** 2 * footDepth + len(ext.filter(w => w.levelId === storeys[0]?.id)) * 0.6 * 0.6;
  const extWallM3 = Math.max(0, extLen * wallH * extT - openArea(extOpen) * extT);
  const intWallM2 = Math.max(0, intLen * wallH - openArea(intOpen));
  const brickM3 = extWallM3 + intWallM2 * intT;
  const bricks = Math.round(brickM3 * 500);
  const plasterInt = (extLen * wallH - openArea(extOpen)) + 2 * intWallM2 + builtUp; // inner face of exterior walls, both faces of partitions, ceilings
  const plasterExt = extLen / Math.max(1, floors) * (H * floors + 1.0) - openArea(extOpen) / Math.max(1, floors) * floors;
  const wallTile = wet.reduce((n, s) => { const xs = s.boundary.map(p => p.x), zs = s.boundary.map(p => p.z); return n + 2 * ((Math.max(...xs) - Math.min(...xs)) + (Math.max(...zs) - Math.min(...zs))) / 1000 * 2.1; }, 0)
    + kitchens.length * 3.0 * 0.6;
  const paint = plasterInt - wallTile + Math.max(0, plasterExt);
  const waterproof = wet.reduce((n, s) => n + area(s.boundary) * 1.3, 0) + footprint;
  const cement = concrete * 8.2 + pcc * 4.4 + brickM3 * 1.25 + (plasterInt + plasterExt) * 0.09 + carpet * 0.28;
  const sand = concrete * 0.42 + pcc * 0.47 + brickM3 * 0.3 + (plasterInt + plasterExt) * 0.016 + carpet * 0.04;
  const aggregate = concrete * 0.84 + pcc * 0.94;
  const mainDoors = Math.max(1, doors.filter(d => d.kind === 'door' && ext.some(w => w.id === d.wallId) && d.type !== 'garage-door').length);
  const internalDoors = doors.filter(d => d.kind === 'door' && !ext.some(w => w.id === d.wallId)).length;

  const t = tier, boq: BoqLine[] = [];
  const add = (code: string, category: string, item: string, unit: string, quantity: number, rate: number) => {
    const q = round(quantity, 2), r = Math.round(rate * f);
    if (q > 0 && r > 0) boq.push({ code, category, item, unit, quantity: q, rateInr: r, amountInr: Math.round(q * r) });
  };
  add('1.1', 'Substructure', 'Earthwork in excavation for foundations, incl. backfilling', 'm³', excavation, RATES.excavation);
  add('1.2', 'Substructure', 'PCC 1:4:8 (M10) bed under footings and floors', 'm³', pcc, RATES.pcc);
  add('1.3', 'Substructure', `RCC M25 isolated footings ${footSide} x ${footSide} m and plinth beams`, 'm³', footConcrete + plinthBeam, RATES.rcc);
  add('2.1', 'RCC frame', `RCC M25 columns ${colSize} mm, incl. formwork`, 'm³', colConcrete, RATES.rcc);
  add('2.2', 'RCC frame', `RCC M25 beams ${beamWidth} x ${beamDepth} mm, incl. formwork`, 'm³', beamConcrete, RATES.rcc);
  add('2.3', 'RCC frame', `RCC M25 slabs ${slabMm} mm (floors and roof), incl. formwork`, 'm³', slabConcrete, RATES.rcc);
  if (stairConcrete) add('2.4', 'RCC frame', 'RCC M25 staircase waist slab and landings', 'm³', stairConcrete, RATES.rcc);
  add('2.5', 'RCC frame', 'Fe500D TMT reinforcement, cut, bent and placed', 'kg', steel, RATES.steel);
  add('3.1', 'Masonry', `Brick masonry ${Math.round(extT * 1000)} mm in CM 1:6 (external walls)`, 'm³', extWallM3, RATES.brick230);
  add('3.2', 'Masonry', `Brick/block partitions ${Math.round(intT * 1000)} mm in CM 1:4`, 'm²', intWallM2, RATES.partition);
  add('4.1', 'Plaster & paint', 'Internal plaster 12 mm CM 1:6 incl. ceilings', 'm²', plasterInt, RATES.plasterInt);
  add('4.2', 'Plaster & paint', 'External plaster 20 mm CM 1:4 in two coats', 'm²', plasterExt, RATES.plasterExt);
  add('4.3', 'Plaster & paint', 'Internal putty, primer and emulsion paint', 'm²', paint - Math.max(0, plasterExt), RATES.paintInt[t]);
  add('4.4', 'Plaster & paint', 'External weatherproof paint', 'm²', plasterExt, RATES.paintExt[t]);
  add('5.1', 'Flooring & tiling', `Flooring (${t === 'economy' ? 'vitrified tiles' : t === 'standard' ? 'double-charged vitrified tiles' : t === 'premium' ? 'granite / large-format tiles' : 'Italian marble / engineered timber'}) incl. skirting`, 'm²', carpet, RATES.flooring[t]);
  add('5.2', 'Flooring & tiling', 'Glazed wall tiles in toilets and kitchen dado', 'm²', wallTile, RATES.wallTile[t]);
  add('5.3', 'Flooring & tiling', 'Waterproofing to toilets and roof (membrane / polymer coating)', 'm²', waterproof, RATES.waterproof);
  add('6.1', 'Doors & windows', 'Main entrance door with frame and hardware', 'no.', mainDoors, RATES.doorMain[t]);
  add('6.2', 'Doors & windows', 'Internal flush doors with frames and hardware', 'no.', internalDoors, RATES.doorInt[t]);
  add('6.3', 'Doors & windows', `${t === 'economy' ? 'Aluminium' : 'UPVC'} windows with glazing and grills`, 'm²', openArea(windows), RATES.window[t]);
  if (model.stairs.length) add('6.4', 'Doors & windows', 'Stair railing (MS / SS with handrail)', 'm', model.stairs.reduce((n, s) => n + s.runMm / 1000 * 1.25, 0), RATES.stairRailing);
  add('7.1', 'Services', 'Electrical wiring, DB, points and fittings', 'm²', builtUp, RATES.electrical[t]);
  add('7.2', 'Services', 'Plumbing and sanitary per bathroom (CP fittings, WC, basin, piping)', 'no.', wet.length, RATES.bathroom[t]);
  add('7.3', 'Services', 'Water supply, drainage, overhead tank and sump', 'm²', builtUp, RATES.plumbingGeneral[t]);
  add('7.4', 'Services', 'Kitchen platform, sink and dado', 'no.', kitchens.length, RATES.kitchen[t]);
  if (RATES.falseCeiling[t]) add('8.1', 'Finishing extras', 'Gypsum false ceiling in living and bedrooms', 'm²', carpet * 0.5, RATES.falseCeiling[t]);
  add('8.2', 'Finishing extras', 'Front elevation treatment (cladding, louvres, lighting)', 'm²', footprint, RATES.elevation[t]);

  const subtotal = boq.reduce((n, l) => n + l.amountInr, 0);
  const margin = Math.round(subtotal * 0.1), contingency = Math.round(subtotal * 0.05);
  const gst = Math.round((subtotal + margin) * 0.18 * 0.35); // works contract GST on the labour/service share (approx. 35 %)
  const total = subtotal + margin + contingency + gst;
  const cats = [...new Set(boq.map(l => l.category))].map(category => { const amountInr = boq.filter(l => l.category === category).reduce((n, l) => n + l.amountInr, 0); return { category, amountInr, sharePct: round(amountInr / subtotal * 100, 1) }; });
  const sqft = builtUp * 10.7639;
  const budget = o.budgetInr ? { budgetInr: o.budgetInr, differenceInr: o.budgetInr - total, status: (o.budgetInr >= total * 1.05 ? 'WITHIN' : o.budgetInr >= total * 0.95 ? 'TIGHT' : 'OVER') as 'WITHIN' | 'TIGHT' | 'OVER' } : null;
  const months = Math.max(6, Math.round(4 + floors * 1.6 + builtUp / 250));
  const weeks = months * 4.3;
  return {
    schemaVersion: 1, basis: 'Concept estimate from the generated building model; IS 456 / IS 875 rules of thumb and illustrative 2026 Indian market rates', currency: 'INR',
    areas: { plotM2: round(plot), footprintM2: round(footprint), builtUpM2: round(builtUp), builtUpSqft: Math.round(sqft), carpetM2: round(carpet), carpetSqft: Math.round(carpet * 10.7639), floors, groundCoveragePct: round(footprint / plot * 100, 1), far: round(builtUp / plot, 2) },
    structure: {
      system: 'RCC framed structure (columns, beams, slabs) with brick masonry infill', concreteGrade: 'M25', steelGrade: 'Fe500D', liveLoadKnM2: live, deadLoadKnM2: dead, factoredLoadKnM2: wu,
      slab: { thicknessMm: slabMm, maxSpanM: round(slabSpan, 2), rule: 'Two-way slab span/effective depth ≈ 32 (IS 456 cl. 24.1), minimum 125 mm' },
      beams: { sizeMm: `${beamWidth} x ${beamDepth}`, maxSpanM: round(beamSpan, 2), rule: 'Continuous beam span/overall depth ≈ 12, width matching 230 mm walls' },
      columns: { count: colCount, sizeMm: colSize, maxFactoredLoadKn: Math.round(pu), rule: 'Short axially loaded column Pu = 0.4 fck Ac + 0.67 fy Asc (IS 456 cl. 39.3) with 1 % steel, M25/Fe500; minimum 230 x 300' },
      footings: { type: 'Isolated pad footings', sizeM: `${footSide} x ${footSide}`, depthM: footDepth, soilBearingKnM2: sbc, rule: `Area = service load / safe bearing capacity (assumed ${sbc} kN/m², medium stiff soil; confirm by soil test)` },
      stair,
    },
    quantities: { concreteM3: round(concrete, 1), steelKg: Math.round(steel), steelTonnes: round(steel / 1000, 2), bricks, cementBags: Math.round(cement), sandM3: round(sand, 1), aggregateM3: round(aggregate, 1), plasterM2: Math.round(plasterInt + plasterExt), flooringM2: round(carpet, 1), wallTileM2: round(wallTile, 1), paintM2: Math.round(paint), waterproofingM2: round(waterproof, 1), doors: mainDoors + internalDoors, windows: windows.length, windowAreaM2: round(openArea(windows), 1), excavationM3: round(excavation, 1) },
    boq,
    summary: { subtotalInr: subtotal, contractorMarginInr: margin, contingencyInr: contingency, gstInr: gst, totalInr: total, perSqftInr: Math.round(total / sqft), perM2Inr: Math.round(total / builtUp), rangeInr: [Math.round(total * 0.9 / 1000) * 1000, Math.round(total * 1.15 / 1000) * 1000], cityFactor: f, byCategory: cats },
    budget,
    timeline: { months, phases: [
      { phase: 'Approvals, soil test and structural design', weeks: Math.round(weeks * 0.12) }, { phase: 'Foundations and plinth', weeks: Math.round(weeks * 0.13) },
      { phase: `RCC frame and slabs (${floors} floor${floors > 1 ? 's' : ''})`, weeks: Math.round(weeks * 0.3) }, { phase: 'Masonry, plaster and services rough-in', weeks: Math.round(weeks * 0.2) },
      { phase: 'Flooring, joinery, painting and fixtures', weeks: Math.round(weeks * 0.2) }, { phase: 'Testing, snagging and handover', weeks: Math.max(2, Math.round(weeks * 0.05)) },
    ] },
    assumptions: [
      `Quality tier "${tier}"${o.city ? `, ${o.city} (city factor ${f})` : ' (no city given; national average rates)'}; rates are illustrative 2026 market rates incl. material and labour.`,
      'Thumb-rule material factors: M25 concrete 8.2 bags cement, 0.42 m³ sand, 0.84 m³ aggregate per m³; 500 bricks and 1.25 bags cement per m³ of masonry.',
      'Steel by element: slabs 85, beams 135, columns 190, footings 65 kg/m³ of concrete.',
      `Live load ${live} kN/m² (IS 875 Part 2 for ${o.buildingType ?? 'residential'} use); safe bearing capacity ${sbc} kN/m² assumed.`,
      'Excludes land, furniture, appliances, landscaping, compound wall, borewell, lift, solar and statutory fees unless listed.',
      'Concept estimate only: structural design, soil investigation and a priced BOQ by a licensed engineer are required before construction.',
    ],
  };
}
