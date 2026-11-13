"""Offline syntax, XML and ACL-reference validation; not an Odoo runtime test."""
import ast
import csv
import pathlib
import xml.etree.ElementTree as ET

root = pathlib.Path(__file__).resolve().parents[1] / 'odoo_addons' / 'odoo_work_assistant'
files = list(root.rglob('*.py'))
for path in files:
    ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
for path in root.rglob('*.xml'):
    ET.parse(path)
manifest = ast.literal_eval((root / '__manifest__.py').read_text())
for filename in manifest['data']:
    assert (root / filename).is_file(), filename
with (root / 'security' / 'ir.model.access.csv').open(newline='') as handle:
    rows = list(csv.DictReader(handle))
    assert len(rows) == 5
    assert all(row['group_id:id'] for row in rows)
print(f'PASS: {len(files)} Python files parse; XML, manifest data and ACL entries are consistent.')
print('Odoo TransactionCase tests require an installed Odoo 19 server and PostgreSQL.')
