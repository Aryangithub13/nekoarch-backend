"""Independent IFC4 schema + OpenCASCADE geometry verification; no exporter imports.
Run using the pinned environment in scripts/requirements-ifc.txt.
"""
import hashlib, json, math, pathlib, resource, time
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import ifcopenshell.validate
import numpy as np

def near(a, b, label, atol=1e-7):
    assert np.allclose(a, b, atol=atol, rtol=1e-8), (label, a, b)

def area(ring):
    return abs(sum(p['x']*ring[(i+1)%len(ring)]['z']-ring[(i+1)%len(ring)]['x']*p['z'] for i,p in enumerate(ring)))/2

def bounds(ring, bottom, top):
    return np.array([[min(p['x'] for p in ring), -max(p['z'] for p in ring), bottom], [max(p['x'] for p in ring), -min(p['z'] for p in ring), top]])/1000

def required_entities(model):
    assert len(model.by_type('IfcProject'))==1 and len(model.by_type('IfcBuilding'))==1

def rejected(check):
    try:
        check()
    except AssertionError:
        return 'REJECTED'
    raise AssertionError('Corrupt IFC negative control was accepted')

def verify_metadata(model, document):
    native=document['model'];bim=document['bim']
    required_entities(model)
    semantic={}
    for e in model.by_type('IfcObjectDefinition'):
        ps=ifcopenshell.util.element.get_psets(e).get('NekoArch_Provenance_v1')
        if ps:
            assert ps['ProjectId']==bim['binding']['projectId'] and ps['RevisionId']==bim['binding']['revisionId'] and ps['ModelHash']==bim['binding']['modelHash'], 'Source binding mismatch'
            assert ps['SemanticId'] not in semantic
            semantic[ps['SemanticId']]=e
    expected_kinds={'project','site','building','level','space','wall','opening','door','window','slab','roof','stair','landing','void','group'}
    expected=[e for e in bim['elements'] if e['kind'] in expected_kinds]
    assert len(semantic)==len(expected)
    for e in expected:
        exported=semantic[e['id']]
        independent_guid=ifcopenshell.guid.compress(hashlib.sha256(('nekoarch-ifc4-v1:'+bim['binding']['projectId']+':'+e['id']).encode()).hexdigest()[:32])
        assert exported.GlobalId==independent_guid
    by_source={(e['kind'],e['source']['id']):semantic[e['id']] for e in expected}
    levels={l['id']:l for l in native['levels']}
    for l in native['levels']:
        e=by_source['level',l['id']];near(e.Elevation,l['elevationMm'],'storey elevation')
        near(ifcopenshell.util.placement.get_local_placement(e.ObjectPlacement)[:3,3],[0,0,l['elevationMm']],'storey transform')
    for opening in native['openings']:
        exported=by_source['opening',opening['id']]
        assert len(exported.VoidsElements)==1 and exported.VoidsElements[0].RelatingBuildingElement==by_source['wall',opening['wallId']], 'Opening host mismatch'
    return semantic, expected, by_source, levels

def verify_schema(model):
    log=ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model,log,express_rules=True)
    assert not log.statements, [(s['message'],str(s.get('instance'))) for s in log.statements[:10]]
    return log

def verify(path):
    started=time.perf_counter()
    document=json.loads(path.with_suffix('.json').read_text()); native=document['model']; bim=document['bim']
    model=ifcopenshell.open(str(path)); parsed=time.perf_counter()
    assert model.schema=='IFC4'
    log=verify_schema(model)
    schema_validated=time.perf_counter()
    required_entities(model)
    near(ifcopenshell.util.unit.calculate_unit_scale(model),0.001,'mm units')
    roots=model.by_type('IfcRoot');guids=[e.GlobalId for e in roots];assert len(set(guids))==len(guids)
    semantic,expected,by_source,levels=verify_metadata(model,document)
    settings=ifcopenshell.geom.settings();settings.set('use-world-coords',True)
    stats={'solids':0,'surfaces':0,'openingHosts':0,'fills':0,'quantities':0,'spaces':0,'stairFlights':0,'specifiedMaterialAssociations':0}
    def check_shape(e, expected_bounds, expected_volume=None, expected_area=None):
        shape=ifcopenshell.geom.create_shape(settings,e);verts=np.array(shape.geometry.verts).reshape(-1,3)
        assert len(verts)>0 and len(shape.geometry.faces)>0
        near(np.array([verts.min(axis=0),verts.max(axis=0)]),expected_bounds,e.is_a()+':bounds')
        if expected_volume is not None:
            near(ifcopenshell.util.shape.get_volume(shape.geometry),expected_volume,e.is_a()+':net volume',atol=1e-6);stats['solids']+=1
        else:stats['surfaces']+=1
        if expected_area is not None:near(ifcopenshell.util.shape.get_area(shape.geometry),expected_area,e.is_a()+':area',atol=1e-6)
    for w in native['walls']:
        e=by_source['wall',w['id']];a=w['path']['start'];b=w['path']['end'];th=w['thicknessMm'];height=w['heightMm'];length=math.hypot(b['x']-a['x'],b['z']-a['z']);ux=(b['x']-a['x'])/length;uz=(b['z']-a['z'])/length
        ring=[{'x':p['x']+sign*(-uz)*th/2,'z':p['z']+sign*ux*th/2} for p,sign in [(a,1),(b,1),(b,-1),(a,-1)]]
        openings=[o for o in native['openings'] if o['wallId']==w['id']];base=levels[w['levelId']]['elevationMm']+w['baseOffsetMm']
        check_shape(e,bounds(ring,base,base+height),(length*height-sum(o['widthMm']*o['heightMm'] for o in openings))*th/1e9)
        assert len(e.ContainedInStructure)==1 and e.ContainedInStructure[0].RelatingStructure==by_source['level',w['levelId']]
    for slab in native['slabs']:
        e=by_source['roof' if slab['kind']=='flat-roof' else 'slab',slab['id']];top=levels[slab['levelId']]['elevationMm']+slab['topOffsetMm']
        net=area(slab['footprint']['outer'])-sum(area(v) for v in slab['footprint']['voids'])
        check_shape(e,bounds(slab['footprint']['outer'],top-slab['thicknessMm'],top),net*slab['thicknessMm']/1e9)
        assert len(e.HasOpenings)==len(slab['footprint']['voids'])
    for o in native['openings']:
        opening=by_source['opening',o['id']];host=by_source['wall',o['wallId']]
        assert len(opening.VoidsElements)==1 and opening.VoidsElements[0].RelatingBuildingElement==host
        assert len(opening.ContainedInStructure)==0;stats['openingHosts']+=1
        if o['kind']!='opening':
            fill=by_source[o['kind'],o['id']];assert len(fill.FillsVoids)==1 and fill.FillsVoids[0].RelatingOpeningElement==opening
            near(fill.OverallWidth,o['widthMm'],'opening width');near(fill.OverallHeight,o['heightMm'],'opening height');stats['fills']+=1
            w=next(w for w in native['walls'] if w['id']==o['wallId']);a=w['path']['start'];b=w['path']['end'];length=math.hypot(b['x']-a['x'],b['z']-a['z']);ux=(b['x']-a['x'])/length;uz=(b['z']-a['z'])/length
            start={'x':a['x']+ux*o['offsetMm'],'z':a['z']+uz*o['offsetMm']};end={'x':start['x']+ux*o['widthMm'],'z':start['z']+uz*o['widthMm']};base=levels[o['levelId']]['elevationMm']+w['baseOffsetMm']+o['sillMm']
            check_shape(fill,bounds([start,end],base,base+o['heightMm']),expected_area=o['widthMm']*o['heightMm']/1e6)
    for space in native['spaces']:
        e=by_source['space',space['id']];base=levels[space['levelId']]['elevationMm'];check_shape(e,bounds(space['boundary'],base,base),expected_area=area(space['boundary'])/1e6)
        assert len(e.Decomposes)==1 and e.Decomposes[0].RelatingObject==by_source['level',space['levelId']];stats['spaces']+=1
    for stair in native['stairs']:
        e=by_source['stair',stair['id']];parts=e.IsDecomposedBy[0].RelatedObjects;flight=next(p for p in parts if p.is_a('IfcStairFlight'));base=levels[stair['fromLevelId']]['elevationMm']
        assert flight.NumberOfRisers==len(stair['riserHeightsMm']) and flight.NumberOfTreads==len(stair['riserHeightsMm'])-1
        check_shape(flight,bounds(stair['footprint'],base,base+stair['riseMm']),expected_area=(stair['runMm']+stair['riseMm'])*stair['widthMm']/1e6);stats['stairFlights']+=1
        assert len(flight.ContainedInStructure)==0
        for landing in stair['landings']:
            e=by_source['landing',landing['id']];h=base+landing['elevationOffsetMm'];check_shape(e,bounds(landing['footprint'],h,h),expected_area=area(landing['footprint'])/1e6)
    geometry_verified=time.perf_counter()
    qmap={q['id']:q for q in bim['quantities']['items']}
    materials={m['id']:m for m in bim['materials']}
    for e in expected:
        exported=semantic[e['id']];qset=ifcopenshell.util.element.get_psets(exported,qtos_only=True).get('NekoArch_NativeQuantities_v1',{})
        material=ifcopenshell.util.element.get_material(exported)
        specified=[materials[key] for key in e['materialIds'] if materials[key]['state']=='specified']
        if specified:
            assert material is not None and material.is_a('IfcMaterial') and material.Name==specified[0]['name']
            stats['specifiedMaterialAssociations']+=1
        else:
            assert material is None,'Unknown material was exported as a specified material'
        for key in e['quantityIds']:
            q=qmap[key];unit=q['quantity']['unit'];divisor={'mm':1,'mm2':1e6,'mm3':1e9,'each':1}[unit]
            near(qset[q['itemCode']],float(q['quantity']['value'])/divisor,'native quantity');stats['quantities']+=1
    # Real negative controls against the external schema-aware validator.
    corrupt=ifcopenshell.file.from_string(model.to_string());r=corrupt.by_type('IfcRoot');r[1].GlobalId=r[0].GlobalId
    bad=ifcopenshell.validate.json_logger();ifcopenshell.validate.validate(corrupt,bad,express_rules=True);assert bad.statements,'Duplicate GUID negative control did not fail'
    missing=ifcopenshell.file.from_string(model.to_string());missing.remove(missing.by_type('IfcProject')[0])
    missing_control=rejected(lambda:required_entities(missing))
    wrong_units=ifcopenshell.file.from_string(model.to_string())
    next(u for u in wrong_units.by_type('IfcSIUnit') if u.UnitType=='LENGTHUNIT').Prefix=None
    unit_control=rejected(lambda:near(ifcopenshell.util.unit.calculate_unit_scale(wrong_units),0.001,'mm units'))
    invalid_guid=ifcopenshell.file.from_string(model.to_string());invalid_guid.by_type('IfcRoot')[0].GlobalId='invalid-guid'
    invalid_guid_control=rejected(lambda:verify_schema(invalid_guid))
    wrong_host=ifcopenshell.file.from_string(model.to_string());relation=wrong_host.by_type('IfcRelVoidsElement')[0]
    relation.RelatingBuildingElement=next(w for w in wrong_host.by_type('IfcWall') if w!=relation.RelatingBuildingElement)
    host_control=rejected(lambda:verify_metadata(wrong_host,document))
    wrong_placement=ifcopenshell.file.from_string(model.to_string())
    point=wrong_placement.by_type('IfcBuildingStorey')[0].ObjectPlacement.RelativePlacement.Location
    x,y,z=point.Coordinates;point.Coordinates=(x,y,z+1000)
    placement_control=rejected(lambda:verify_metadata(wrong_placement,document))
    dangling=ifcopenshell.file.from_string(model.to_string())
    dangling.remove(dangling.by_type('IfcRelVoidsElement')[0].RelatedOpeningElement)
    target_control=rejected(lambda:verify_schema(dangling))
    binding=ifcopenshell.file.from_string(model.to_string())
    prop=next(p for p in binding.by_type('IfcPropertySingleValue') if p.Name=='ModelHash')
    prop.NominalValue=binding.create_entity('IfcText','0'*64)
    binding_control=rejected(lambda:verify_metadata(binding,document))
    return {'fixture':path.name,'schema':model.schema,'entities':len(list(model)),'schemaDiagnostics':len(log.statements),'parseMs':(parsed-started)*1000,'schemaValidationMs':(schema_validated-parsed)*1000,'geometryAndRelationshipsMs':(geometry_verified-schema_validated)*1000,'roundTripMs':(time.perf_counter()-started)*1000,'parserPeakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,**stats,'informationLoss':document['validation']['export']['limitations'],'duplicateGuidNegativeControl':'REJECTED','missingProjectNegativeControl':missing_control,'wrongUnitsNegativeControl':unit_control,'invalidGuidNegativeControl':invalid_guid_control,'wrongHostNegativeControl':host_control,'wrongStoreyPlacementNegativeControl':placement_control,'missingRelationshipTargetNegativeControl':target_control,'sourceBindingNegativeControl':binding_control}

paths=sorted(pathlib.Path('docs/phase23-evidence/fixtures').glob('*.ifc'))
assert {p.stem for p in paths}=={'v1','v2','L','setback','maximum-24','modified','specified-material'},'Generate all seven representative fixtures before verification'
rows=[]
for path in paths:
    row=verify(path);rows.append(row);print(json.dumps(row),flush=True)
pathlib.Path('docs/backend-audit-1-23/evidence/ifc-verification.json').write_text(json.dumps({'parser':'IfcOpenShell','version':ifcopenshell.version,'geometryKernel':'OpenCASCADE','fixtures':rows},indent=2)+'\n')
