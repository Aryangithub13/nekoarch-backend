"""Supplement geometry reconstruction with exact independent IFC profile topology checks.

Run from repository root with the pinned IfcOpenShell environment. Comparing
edges catches an L-notch/void relocation that preserves bounds and net volume.
"""
import json
from pathlib import Path
import ifcopenshell
import ifcopenshell.util.element


def native_edges(ring):
    points = [(p['x'], p['z']) for p in ring]
    return sorted(tuple(sorted((p, points[(i+1) % len(points)]))) for i, p in enumerate(points))


def profile_edges(product):
    solid = product.Representation.Representations[0].Items[0]
    assert solid.is_a('IfcExtrudedAreaSolid')
    points = solid.SweptArea.OuterCurve.Points
    assert points[0].Coordinates == points[-1].Coordinates
    return native_edges([{'x':p.Coordinates[0], 'z':-p.Coordinates[1]} for p in points[:-1]])


rows = []
for fixture in sorted(Path('docs/phase23-evidence/fixtures').glob('*.ifc')):
    native = json.loads(fixture.with_suffix('.json').read_text())['model']
    model = ifcopenshell.open(str(fixture))
    products = {}
    for product in model.by_type('IfcProduct'):
        pset = ifcopenshell.util.element.get_psets(product).get('NekoArch_Provenance_v1', {})
        if 'NativeElementId' in pset:
            products[pset['NativeElementId']] = product
    voids = 0
    for slab in native['slabs']:
        product = products[slab['id']]
        assert profile_edges(product) == native_edges(slab['footprint']['outer']), slab['id']
        openings = sorted(profile_edges(r.RelatedOpeningElement) for r in product.HasOpenings)
        assert openings == sorted(native_edges(v) for v in slab['footprint']['voids']), slab['id']
        voids += len(openings)
    negative = 'not applicable: rectangular fixture'
    concave = next((s for s in native['slabs'] if len(s['footprint']['outer']) == 6), None)
    if concave:
        product = products[concave['id']]
        points = product.Representation.Representations[0].Items[0].SweptArea.OuterCurve.Points
        xmin, xmax = min(p.Coordinates[0] for p in points), max(p.Coordinates[0] for p in points)
        # The closing point shares its entity with the first point; mutate once.
        for point in {p.id():p for p in points}.values():
            x, y = point.Coordinates
            point.Coordinates = (xmin + xmax - x, y)
        assert profile_edges(product) != native_edges(concave['footprint']['outer']), 'Mirrored notch accepted'
        negative = 'REJECTED'
    rows.append({'fixture':fixture.name, 'exactSlabProfiles':len(native['slabs']),
                 'exactVoidProfiles':voids, 'mirroredNotchNegativeControl':negative})
assert len(rows) == 7
Path('docs/phase23-evidence/ifc-profile-verification.json').write_text(json.dumps(rows, indent=2)+'\n')
print(json.dumps(rows, indent=2))
