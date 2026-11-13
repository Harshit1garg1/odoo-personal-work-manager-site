"""All business operations run as the authenticated user; no sudo or arbitrary RPC."""
import copy
import hashlib
import json
import re
import secrets
from datetime import timedelta
import pytz

from odoo import api, fields, models, _, release
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import SQL

CONCEPTS = ('project', 'task', 'timesheet', 'todo', 'note')
ACTIONS = ('create', 'update', 'complete', 'submit', 'approve')
IDENTIFIER = re.compile(r'^[a-zA-Z][a-zA-Z0-9_.]*$')


def validate_mapping(value):
    if not isinstance(value, dict) or set(value) - set(CONCEPTS):
        raise ValueError('Mappings must be an object keyed by project, task, timesheet, todo or note.')
    for concept, config in value.items():
        if config is False:
            continue
        if not isinstance(config, dict) or set(config) - {'model', 'fields', 'editable', 'defaults', 'domain', 'owner', 'completion', 'actions'}:
            raise ValueError('Unknown mapping property for %s.' % concept)
        if not isinstance(config.get('model'), str) or not IDENTIFIER.fullmatch(config['model']):
            raise ValueError('Each override must specify a model.')
        aliases = config.get('fields', {})
        if not isinstance(aliases, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not IDENTIFIER.fullmatch(v) for k, v in aliases.items()):
            raise ValueError('Fields must map logical names to real field names.')
        if not isinstance(config.get('editable', []), list) or any(x not in aliases for x in config.get('editable', [])):
            raise ValueError('Editable values must name mapped logical fields.')
        if not isinstance(config.get('defaults', {}), dict) or set(config.get('defaults', {})) - set(aliases):
            raise ValueError('Defaults must use mapped logical fields.')
        if not isinstance(config.get('domain', []), list):
            raise ValueError('Domain must be a list.')
        for action, spec in config.get('actions', {}).items():
            if action not in ('complete', 'submit', 'approve') or not isinstance(spec, dict):
                raise ValueError('Only complete, submit and approve actions may be configured.')
            method = spec.get('method', '')
            if not re.fullmatch(r'action_[A-Za-z0-9_]+', method):
                raise ValueError('Custom methods must start with action_.')
            if not isinstance(spec.get('verify'), dict) or not spec['verify'] or set(spec['verify']) - set(aliases):
                raise ValueError('Actions require a nonempty verify mapping of logical fields to expected saved values.')
        if 'completion' in config:
            completion = config['completion']
            if not isinstance(completion, dict) or completion.get('field') not in aliases or not isinstance(completion.get('done'), list) or not completion['done']:
                raise ValueError('Completion requires a mapped field and a nonempty done list.')
            if not isinstance(completion.get('cancelled', []), list) or any(x in completion['done'] for x in completion.get('cancelled', [])):
                raise ValueError('Done and cancelled values must be separate.')
        owner = config.get('owner')
        if owner and (not isinstance(owner, dict) or owner.get('field') not in aliases or owner.get('identity') not in ('user', 'employee')):
            raise ValueError('Owner requires a mapped field and user or employee identity.')
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def conventional_mappings():
    return {
        'project': {'model': 'project.project', 'fields': {'name': 'name', 'description': 'description', 'status': 'stage_id', 'company': 'company_id'}, 'editable': ['name', 'description']},
        'task': {'model': 'project.task', 'fields': {'name': 'name', 'description': 'description', 'project': 'project_id', 'assignees': 'user_ids', 'deadline': 'date_deadline', 'priority': 'priority', 'status': 'state', 'stage': 'stage_id', 'allocated_hours': 'allocated_hours', 'actual_hours': 'effective_hours', 'remaining_hours': 'remaining_hours', 'company': 'company_id'}, 'editable': ['name', 'description', 'project', 'assignees', 'deadline', 'priority', 'allocated_hours'], 'owner': {'field': 'assignees', 'identity': 'user'}, 'completion': {'field': 'status', 'done': ['1_done'], 'cancelled': ['1_canceled']}},
        'timesheet': {'model': 'account.analytic.line', 'fields': {'name': 'name', 'date': 'date', 'employee': 'employee_id', 'project': 'project_id', 'task': 'task_id', 'hours': 'unit_amount', 'company': 'company_id'}, 'editable': ['name', 'date', 'project', 'task', 'hours'], 'owner': {'field': 'employee', 'identity': 'employee'}, 'domain': [['project_id', '!=', False]]},
        'todo': {'model': 'odoo.work.todo', 'fields': {'name': 'name', 'description': 'description', 'deadline': 'date_deadline', 'status': 'state', 'owner': 'user_id', 'company': 'company_id'}, 'editable': ['name', 'description', 'deadline'], 'owner': {'field': 'owner', 'identity': 'user'}, 'completion': {'field': 'status', 'done': ['done'], 'cancelled': ['cancelled']}},
        'note': {'model': 'odoo.work.note', 'fields': {'name': 'name', 'body': 'body', 'owner': 'user_id', 'company': 'company_id'}, 'editable': ['name', 'body'], 'owner': {'field': 'owner', 'identity': 'user'}},
    }


class WorkService(models.AbstractModel):
    _name = 'odoo.work.service'
    _description = 'Permission-aware assistant operations'

    def _scoped(self, payload):
        if not self.env.user.has_group('base.group_user'):
            raise AccessError(_('An internal Odoo user is required.'))
        company_id = payload.get('company_id') or self.env.user.company_id.id
        if type(company_id) is not int or company_id not in self.env.user.company_ids.ids:
            raise AccessError(_('This company is not available to your Odoo user.'))
        return self.with_context(allowed_company_ids=[company_id]).with_company(self.env['res.company'].browse(company_id))

    def _employee_id(self):
        if 'hr.employee' not in self.env:
            raise UserError(_('Employee mapping is unavailable.'))
        employees = self.env['hr.employee'].search([('user_id', '=', self.env.uid), ('company_id', '=', self.env.company.id)], limit=2)
        if len(employees) != 1:
            raise UserError(_('Your user must map to exactly one employee in the selected company.'))
        return employees.id

    def _profile(self):
        mapping = conventional_mappings()
        profile = self.env['odoo.work.profile'].search([('company_id', '=', self.env.company.id)], limit=1)
        if profile:
            mapping.update(json.loads(profile.mapping_json))
        return mapping

    def _config(self, concept):
        if concept not in CONCEPTS:
            raise ValidationError(_('Unknown work concept.'))
        config = copy.deepcopy(self._profile().get(concept))
        if not config or config['model'] not in self.env:
            raise UserError(_('This capability is not installed or mapped: %s', concept))
        model = self.env[config['model']]
        if not model.has_access('read'):
            raise AccessError(_('You cannot read this capability.'))
        metadata = model.fields_get(attributes=['string', 'type', 'relation', 'required', 'readonly', 'selection', 'store'])
        config['fields'] = {key: value for key, value in config['fields'].items() if value in metadata}
        if 'name' not in config['fields']:
            raise UserError(_('The name mapping is missing or inaccessible. Ask your administrator to update the profile.'))
        if concept == 'timesheet' and not all(key in config['fields'] for key in ('employee', 'project', 'date', 'hours')):
            raise UserError(_('The Timesheets application or its required field mappings are unavailable.'))
        config['editable'] = [key for key in config.get('editable', []) if key in config['fields'] and not metadata[config['fields'][key]].get('readonly') and not model._fields[config['fields'][key]].related]
        completion = config.get('completion')
        if completion:
            field = config['fields'].get(completion['field'])
            choices = dict(metadata.get(field, {}).get('selection', []))
            if not field or metadata[field]['type'] not in ('selection', 'boolean', 'char', 'integer', 'many2one') or (choices and any(x not in choices for x in completion['done'] + completion.get('cancelled', []))):
                config.pop('completion')
        owner = config.get('owner')
        if owner and owner['field'] not in config['fields']:
            raise UserError(_('The owner mapping is unavailable; refusing to broaden personal scope.'))
        return model, config, metadata

    def _domain(self, concept, config, scope='mine'):
        domain = copy.deepcopy(config.get('domain', []))
        if 'company' in config['fields']:
            domain.append((config['fields']['company'], 'in', [False, self.env.company.id]))
        if scope not in ('mine', 'accessible'):
            raise ValidationError(_('Scope must be mine or accessible.'))
        if scope == 'mine':
            owner = config.get('owner')
            if owner:
                identity = self.env.uid if owner['identity'] == 'user' else self._employee_id()
                domain.append((config['fields'][owner['field']], 'in', [identity]))
            elif concept == 'project':
                task_model, task_config, _metadata = self._config('task')
                project_field = task_config['fields'].get('project')
                if not project_field:
                    raise UserError(_('Personal project scope needs a verified task-to-project mapping.'))
                groups = task_model.read_group(self._domain('task', task_config), [project_field], [project_field], lazy=False)
                domain.append(('id', 'in', [row[project_field][0] for row in groups if row.get(project_field)]))
            else:
                raise UserError(_('Personal scope needs an owner mapping.'))
        return domain

    def _record(self, concept, record_id, scope='accessible'):
        if type(record_id) is not int or record_id < 1:
            raise ValidationError(_('A positive record ID is required.'))
        model, config, metadata = self._config(concept)
        record = model.search(self._domain(concept, config, scope) + [('id', '=', record_id)], limit=1)
        if not record:
            raise AccessError(_('The record is missing or outside your permitted scope.'))
        return record, config, metadata

    def _snapshot(self, record, config):
        names = list(set(config['fields'].values()) | {'write_date'})
        raw = record.read(names)[0]
        normalized = {key: raw[value] for key, value in config['fields'].items()}
        normalized.update(id=record.id, modified_at=str(raw['write_date']))
        completion = config.get('completion')
        state = normalized.get(completion['field']) if completion else None
        if isinstance(state, (list, tuple)) and state:
            state = state[0]
        normalized['completion'] = ('done' if state in completion['done'] else 'cancelled' if state in completion.get('cancelled', []) else 'open') if completion else 'unknown'
        return normalized

    @api.model
    def work_context(self, payload=None):
        service = self._scoped(payload or {})
        return {'protocol': 1, 'version': release.version, 'user': {'id': service.env.uid, 'name': service.env.user.name}, 'company': {'id': service.env.company.id, 'name': service.env.company.name}, 'companies': [{'id': c.id, 'name': c.name} for c in service.env.user.company_ids], 'timezone': service.env.user.tz or 'UTC', 'source': 'Odoo ORM', 'profile_revision': digest(service._profile())}

    @api.model
    def work_describe(self, payload=None):
        payload = payload or {}
        service = self._scoped(payload)
        result = {'context': service.work_context(payload), 'capabilities': {}}
        for concept in CONCEPTS:
            try:
                model, config, metadata = service._config(concept)
                writable = model.has_access('write')
                actions = config.get('actions', {})
                completion_field = config['fields'].get(config.get('completion', {}).get('field'))
                direct_completion = completion_field and not metadata[completion_field].get('readonly') and not model._fields[completion_field].related
                result['capabilities'][concept] = {'available': True, 'model': model._name, 'fields': {key: {**metadata[name], 'field': name, 'editable': key in config.get('editable', [])} for key, name in config['fields'].items()}, 'permissions': {'read': True, 'create': model.has_access('create'), 'update': writable, 'complete': writable and bool(direct_completion or actions.get('complete')), 'submit': writable and 'submit' in actions, 'approve': writable and 'approve' in actions}, 'completion': config.get('completion'), 'actions': actions, 'note': 'Record rules and business validation are checked on each operation.'}
            except (AccessError, UserError) as error:
                result['capabilities'][concept] = {'available': False, 'reason': str(error)}
        result['modules'] = {'available': False, 'reason': 'Module inventory requires technical read access; capability discovery still works.'}
        if payload.get('include_modules'):
            try:
                rows = service.env['ir.module.module'].search_read([('state', '=', 'installed')], ['name', 'shortdesc', 'installed_version'], limit=1000)
                result['modules'] = {'available': True, 'records': rows, 'truncated': len(rows) == 1000}
            except AccessError:
                pass
        return result

    @api.model
    def work_people(self, payload=None):
        payload = payload or {}
        service = self._scoped(payload)
        limit = payload.get('limit', 50)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValidationError(_('Invalid directory limit.'))
        domain = [('share', '=', False), ('company_ids', 'in', [service.env.company.id])]
        if payload.get('search'):
            domain.append(('name', 'ilike', str(payload['search'])[:200]))
        people = service.env['res.users'].search_read(domain, ['name'], limit=limit, order='name, id')
        return {'records': people, 'truncated': len(people) == limit, 'note': 'Odoo checks project-specific assignment rules when saving.'}

    @api.model
    def work_list(self, payload=None):
        payload = payload or {}
        service = self._scoped(payload)
        concept = payload.get('concept', 'task')
        model, config, metadata = service._config(concept)
        scope = payload.get('scope', 'mine')
        domain = service._domain(concept, config, scope)
        limit = payload.get('limit', 50)
        offset = payload.get('offset', 0)
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or not 0 <= offset <= 100000:
            raise ValidationError(_('Invalid pagination.'))
        filters = payload.get('filters', {})
        if not isinstance(filters, dict) or set(filters) - {'search', 'project_id', 'completion', 'date_from', 'date_to'}:
            raise ValidationError(_('Unknown list filter.'))
        if filters.get('search'):
            domain.append((config['fields']['name'], 'ilike', str(filters['search'])[:200]))
        if filters.get('project_id'):
            if 'project' not in config['fields']:
                raise ValidationError(_('This concept has no project mapping.'))
            domain.append((config['fields']['project'], '=', int(filters['project_id'])))
        completion_filter = filters.get('completion')
        completion = config.get('completion')
        if completion_filter:
            if completion_filter not in ('open', 'done', 'cancelled') or not completion:
                raise ValidationError(_('Completion mapping is unavailable or filter is invalid.'))
            done, cancelled = completion['done'], completion.get('cancelled', [])
            domain.append((config['fields'][completion['field']], 'not in' if completion_filter == 'open' else 'in', done + cancelled if completion_filter == 'open' else done if completion_filter == 'done' else cancelled))
        for key, operator in [('date_from', '>='), ('date_to', '<=')]:
            if filters.get(key):
                date_field = config['fields'].get('date') or config['fields'].get('deadline')
                if not date_field:
                    raise ValidationError(_('This concept has no date mapping.'))
                date = fields.Date.to_date(filters[key])
                if metadata[date_field]['type'] == 'datetime':
                    timezone = pytz.timezone(service.env.user.tz or 'UTC')
                    boundary = fields.Datetime.to_datetime(date + (timedelta(days=1) if key == 'date_to' else timedelta()))
                    utc = timezone.localize(boundary).astimezone(pytz.UTC).replace(tzinfo=None)
                    domain.append((date_field, '<' if key == 'date_to' else '>=', fields.Datetime.to_string(utc)))
                else:
                    domain.append((date_field, operator, str(date)))
        count = model.search_count(domain)
        records = model.search(domain, limit=limit, offset=offset, order='id desc')
        summaries = {'done': None, 'open': None, 'cancelled': None, 'hours': None}
        if completion:
            # All summaries use the same record-rule-scoped domain and filters.
            for label, values in [('done', completion['done']), ('cancelled', completion.get('cancelled', []))]:
                summaries[label] = model.search_count(domain + [(config['fields'][completion['field']], 'in', values)])
            summaries['open'] = count - summaries['done'] - summaries['cancelled']
        if concept == 'timesheet' and 'hours' in config['fields']:
            hour_field = config['fields']['hours']
            totals = model.read_group(domain, [hour_field + ':sum'], [])
            summaries['hours'] = totals[0].get(hour_field, 0) if totals else 0
        return {'concept': concept, 'records': [service._snapshot(r, config) for r in records], 'total': count, 'offset': offset, 'next_offset': offset + len(records) if offset + len(records) < count else None, 'summary': summaries, 'scope': scope, 'filters': filters, 'company_id': service.env.company.id, 'timezone': service.env.user.tz or 'UTC', 'as_of': str(fields.Datetime.now())}

    def _normalize_values(self, concept, config, metadata, values, creating=False):
        if not isinstance(values, dict):
            raise ValidationError(_('Values must be an object.'))
        editable = config.get('editable', [])
        if set(values) - set(editable):
            raise ValidationError(_('Only discovered editable fields may be changed.'))
        logical = {**config.get('defaults', {}), **values} if creating else dict(values)
        if creating and config.get('owner'):
            owner = config['owner']
            if owner['field'] not in logical:
                identity = self.env.uid if owner['identity'] == 'user' else self._employee_id()
                owner_field = config['fields'][owner['field']]
                logical[owner['field']] = [identity] if metadata[owner_field]['type'] == 'many2many' else identity
        if creating and 'company' in config['fields']:
            company_field = config['fields']['company']
            if not metadata[company_field].get('readonly'):
                logical['company'] = self.env.company.id
            elif self.env[config['model']].default_get([company_field]).get(company_field) != self.env.company.id:
                raise ValidationError(_('The readonly company default does not match the selected company.'))
        if logical.get('project'):
            self._record('project', logical['project'])
        if concept == 'timesheet':
            if creating and not all(logical.get(key) for key in ('name', 'date', 'project')):
                raise ValidationError(_('Timesheets require a description, date, project and positive hours.'))
            if 'hours' in logical and (type(logical['hours']) not in (int, float) or not 0 < logical['hours'] <= 24):
                raise ValidationError(_('Timesheet hours must be greater than zero and at most 24.'))
            if creating and 'hours' not in logical:
                raise ValidationError(_('Timesheet hours are required.'))
            if logical.get('task'):
                task, task_config, _meta = self._record('task', logical['task'])
                project_field = task_config['fields'].get('project')
                if logical.get('project') and project_field and task[project_field].id != logical['project']:
                    raise ValidationError(_('The selected task does not belong to the selected project.'))
        result = {}
        for key, value in logical.items():
            if key not in config['fields']:
                raise ValidationError(_('A configured default field no longer exists.'))
            name = config['fields'][key]
            field = self.env[config['model']]._fields[name]
            if metadata[name].get('readonly') or field.related:
                raise ValidationError(_('This field cannot be changed through the assistant: %s', key))
            kind = metadata[name]['type']
            if kind in ('many2many', 'one2many'):
                if kind == 'one2many' or not isinstance(value, list) or any(type(x) is not int or x <= 0 for x in value):
                    raise ValidationError(_('Use a list of positive relation IDs. One-to-many writes are not supported.'))
                related = self.env[field.comodel_name].browse(value)
                related.check_access('read')
                if len(related.exists()) != len(set(value)):
                    raise ValidationError(_('A related record no longer exists.'))
                self._check_relation_company(related)
                result[name] = [(6, 0, value)]
            else:
                if kind == 'many2one' and value:
                    if type(value) is not int or value <= 0:
                        raise ValidationError(_('Use a positive relation ID.'))
                    related = self.env[field.comodel_name].browse(value)
                    related.check_access('read')
                    if not related.exists():
                        raise ValidationError(_('A related record no longer exists.'))
                    self._check_relation_company(related)
                if kind == 'selection' and value not in dict(metadata[name].get('selection', [])) and value is not False:
                    raise ValidationError(_('Invalid selection value for %s', key))
                if kind in ('date', 'datetime') and value:
                    (fields.Date.to_date if kind == 'date' else fields.Datetime.to_datetime)(value)
                if kind in ('char', 'text', 'html') and not isinstance(value, str) and value is not False:
                    raise ValidationError(_('Text fields require text.'))
                result[name] = value
        return result

    def _check_relation_company(self, related):
        if related._name == 'res.users':
            count = related.search_count([('id', 'in', related.ids), ('company_ids', 'in', [self.env.company.id])])
            if count != len(related):
                raise ValidationError(_('An assignee is outside the selected company.'))
        elif 'company_id' in related._fields and any(record.company_id and record.company_id != self.env.company for record in related):
            raise ValidationError(_('A related record belongs to a different company.'))

    @api.model
    def work_prepare(self, payload=None):
        payload = payload or {}
        service = self._scoped(payload)
        concept, action = payload.get('concept'), payload.get('action')
        if action not in ACTIONS:
            raise ValidationError(_('Unsupported action.'))
        model, config, metadata = service._config(concept)
        creating = action == 'create'
        if not model.has_access('create' if creating else 'write'):
            raise AccessError(_('You do not have permission for this operation.'))
        before, method, verify, record = None, None, {}, None
        if not creating:
            record, config, metadata = service._record(concept, payload.get('record_id'))
            record.check_access('write')
            if concept == 'timesheet' and 'readonly_timesheet' in record._fields and record.readonly_timesheet:
                raise UserError(_('This timesheet is locked by its installed workflow.'))
            before = service._snapshot(record, config)
        if action in ('create', 'update'):
            if not creating and not payload.get('values'):
                raise ValidationError(_('Provide at least one field to update.'))
            values = service._normalize_values(concept, config, metadata, payload.get('values', {}), creating)
            verify = dict(payload.get('values', {}))
            if creating:
                verify = {key: values[name][0][2] if metadata[name]['type'] == 'many2many' else values[name] for key, name in config['fields'].items() if name in values}
                if 'company' in config['fields']:
                    verify['company'] = service.env.company.id
            if creating:
                defaults = model.default_get([name for name, meta in metadata.items() if meta.get('required') and not meta.get('readonly')])
                def required_value(name, meta):
                    value = values.get(name, defaults.get(name))
                    return value is not None if meta['type'] in ('float', 'integer', 'monetary', 'boolean') else bool(value)
                missing = [name for name, meta in metadata.items() if meta.get('required') and not meta.get('readonly') and not model._fields[name].compute and not required_value(name, meta)]
                if missing:
                    raise ValidationError(_('Required fields need mapping or values: %s', ', '.join(missing)))
        else:
            if payload.get('values'):
                raise ValidationError(_('Workflow actions do not accept additional field changes.'))
            spec = config.get('actions', {}).get(action)
            if spec:
                method = spec['method']
                if not callable(getattr(record, method, None)):
                    raise ValidationError(_('The configured action is unavailable.'))
                verify = spec['verify']
                values = {}
            elif action == 'complete' and config.get('completion'):
                completion = config['completion']
                status_field = config['fields'][completion['field']]
                if metadata[status_field].get('readonly') or model._fields[status_field].related:
                    raise UserError(_('Completion needs a supported workflow action for this readonly status.'))
                verify = {completion['field']: completion['done'][0]}
                # Completion is allowed only via the explicitly discovered status mapping.
                values = {config['fields'][completion['field']]: completion['done'][0]}
            else:
                raise UserError(_('Ask your administrator to map this workflow action.'))
        if concept == 'timesheet' and not creating and action == 'update':
            merged = {key: val for key, val in before.items() if key in config.get('editable', [])}
            for key in ('project', 'task'):
                if isinstance(merged.get(key), (list, tuple)):
                    merged[key] = merged[key][0]
            merged.update(payload.get('values', {}))
            service._normalize_values(concept, config, metadata, merged)
        token = secrets.token_urlsafe(32)
        request = {'concept': concept, 'action': action, 'model': model._name, 'record_id': record.id if record else None, 'values': values, 'method': method, 'verify': verify, 'before_hash': digest(before), 'profile_revision': digest(service._profile()), 'schema_revision': digest({'config': config, 'metadata': metadata})}
        preview = {'concept': concept, 'action': action, 'record_id': request['record_id'], 'before': before, 'changes': verify, 'acting_user': service.env.user.name, 'company': service.env.company.name, 'method': method, 'side_effects': config.get('actions', {}).get(action, {}).get('side_effects', 'Odoo defaults, computed values, constraints, automation and normal notifications may run. No extra chatter message is posted by this connector.'), 'expires_in_seconds': 600}
        service.env['odoo.work.operation']._new({'token_hash': digest(token), 'user_id': service.env.uid, 'company_id': service.env.company.id, 'expires_at': fields.Datetime.now() + timedelta(minutes=10), 'request_json': json.dumps(request, default=str), 'preview_json': json.dumps(preview, default=str)})
        return {'operation_id': token, 'company_id': service.env.company.id, 'preview': preview, 'requires_confirmation': True}

    def _operation(self, token):
        if not isinstance(token, str) or len(token) > 100:
            raise ValidationError(_('Invalid operation ID.'))
        operation = self.env['odoo.work.operation'].search([('token_hash', '=', digest(token)), ('user_id', '=', self.env.uid), ('company_id', '=', self.env.company.id)], limit=1)
        if not operation:
            raise AccessError(_('Operation is missing or belongs to another account/company.'))
        return operation

    @api.model
    def work_result(self, payload=None):
        payload = payload or {}
        service = self._scoped(payload)
        operation = service._operation(payload.get('operation_id'))
        return json.loads(operation.response_json) if operation.response_json else {'status': 'prepared', 'preview': json.loads(operation.preview_json), 'expired': operation.expires_at < fields.Datetime.now()}

    @api.model
    def work_execute(self, payload=None):
        payload = payload or {}
        if payload.get('confirmed') is not True:
            raise ValidationError(_('Explicit confirmation of the preview is required.'))
        service = self._scoped(payload)
        operation = service._operation(payload.get('operation_id'))
        # Row locks serialize retries and the business update in this single ORM transaction.
        service.env.cr.execute(SQL('SELECT id FROM %s WHERE id = %s FOR UPDATE', SQL.identifier(operation._table), operation.id))
        operation.invalidate_recordset()
        if operation.response_json:
            return json.loads(operation.response_json)
        if operation.expires_at < fields.Datetime.now():
            raise UserError(_('This preview expired. Prepare and confirm a fresh preview.'))
        request = json.loads(operation.request_json)
        if request['profile_revision'] != digest(service._profile()):
            raise UserError(_('Company mappings changed. Prepare a new preview.'))
        model, config, metadata = service._config(request['concept'])
        if model._name != request['model']:
            raise UserError(_('Model mapping changed. Prepare a new preview.'))
        if request['schema_revision'] != digest({'config': config, 'metadata': metadata}):
            raise UserError(_('Model fields or permissions changed. Prepare a new preview.'))
        if request['action'] == 'create':
            record = model.create(request['values'])
        else:
            record, config, _metadata = service._record(request['concept'], request['record_id'])
            record.check_access('write')
            service.env.cr.execute(SQL('SELECT id FROM %s WHERE id = %s FOR UPDATE', SQL.identifier(record._table), record.id))
            record.invalidate_recordset()
            if digest(service._snapshot(record, config)) != request['before_hash']:
                raise UserError(_('The record changed after the preview. Prepare a new preview.'))
            if request['concept'] == 'timesheet' and 'readonly_timesheet' in record._fields and record.readonly_timesheet:
                raise UserError(_('This timesheet is locked by its installed workflow.'))
            if request['method']:
                action_result = getattr(record, request['method'])()
                if isinstance(action_result, dict) and action_result.get('type', '').startswith('ir.actions.'):
                    raise UserError(_('This workflow requires an interactive Odoo wizard. Open Odoo to finish it; this transaction was rolled back.'))
            else:
                record.write(request['values'])
        record.invalidate_recordset()
        after = service._snapshot(record, config)
        for key, expected in request['verify'].items():
            actual = after.get(key)
            kind = metadata[config['fields'][key]]['type']
            if kind == 'html':
                expected = model._fields[config['fields'][key]].convert_to_cache(expected, record)
            if kind in ('date', 'datetime'):
                converter = fields.Date.to_date if kind == 'date' else fields.Datetime.to_datetime
                actual = converter(actual) if actual else False
                expected = converter(expected) if expected else False
            if kind == 'many2one' and isinstance(actual, (list, tuple)):
                actual = actual[0]
            if kind == 'many2many':
                actual, expected = sorted(actual or []), sorted(expected or [])
            if kind in ('float', 'monetary') and type(actual) in (int, float) and type(expected) in (int, float):
                matches = abs(actual - expected) < 0.00001
            else:
                matches = actual == expected or (actual is False and expected == '')
            if not matches:
                raise UserError(_('The workflow did not reach the expected state. This transaction was rolled back.'))
        response = {'status': 'verified', 'concept': request['concept'], 'action': request['action'], 'record': after, 'acting_user': service.env.user.name, 'company_id': service.env.company.id}
        operation._save_response(response)
        return response
