import json
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError


class WorkProfile(models.Model):
    _name = 'odoo.work.profile'
    _description = 'Work assistant company mapping'

    name = fields.Char(required=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    mapping_json = fields.Text(required=True, default='{}', help='Concept overrides. See docs/custom-modules.md in the connector package.')
    _company_unique = models.Constraint('UNIQUE(company_id)', 'Only one assistant mapping per company is allowed.')

    @api.constrains('mapping_json')
    def _check_mapping(self):
        from .service import validate_mapping
        for record in self:
            try:
                value = json.loads(record.mapping_json)
                validate_mapping(value)
            except (ValueError, TypeError) as error:
                raise ValidationError(str(error)) from error


class WorkTodo(models.Model):
    _name = 'odoo.work.todo'
    _description = 'Personal assistant todo'
    _order = 'date_deadline, id desc'

    name = fields.Char(required=True)
    description = fields.Text()
    user_id = fields.Many2one('res.users', required=True, default=lambda self: self.env.user, index=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company, index=True)
    date_deadline = fields.Date()
    state = fields.Selection([('open', 'Open'), ('done', 'Done'), ('cancelled', 'Cancelled')], default='open', required=True)


class WorkNote(models.Model):
    _name = 'odoo.work.note'
    _description = 'Private assistant note'
    _order = 'write_date desc, id desc'

    name = fields.Char(required=True)
    body = fields.Text()
    user_id = fields.Many2one('res.users', required=True, default=lambda self: self.env.user, index=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company, index=True)


class WorkOperation(models.Model):
    _name = 'odoo.work.operation'
    _description = 'Assistant write preview and receipt'

    token_hash = fields.Char(required=True, index=True)
    user_id = fields.Many2one('res.users', required=True, index=True)
    company_id = fields.Many2one('res.company', required=True, index=True)
    expires_at = fields.Datetime(required=True)
    request_json = fields.Text(required=True)
    preview_json = fields.Text(required=True)
    response_json = fields.Text()
    _token_unique = models.Constraint('UNIQUE(token_hash)', 'Operation identifier must be unique.')

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(_('Use the assistant prepare operation.'))

    def write(self, values):
        raise AccessError(_('Operation receipts cannot be edited through the API.'))

    def unlink(self):
        raise AccessError(_('Operation receipts are retained for duplicate prevention.'))

    @api.model
    def _new(self, values):
        return super().create(values)

    def _save_response(self, response):
        return super().write({'response_json': json.dumps(response, default=str)})
