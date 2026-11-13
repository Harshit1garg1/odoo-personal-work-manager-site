import json
from odoo import http
from odoo.http import request
from odoo.exceptions import AccessError, UserError, ValidationError


class WorkApi(http.Controller):
    @http.route('/odoo-work/v1/<string:operation>', type='http', auth='bearer', methods=['POST'], csrf=False, save_session=False)
    def work_api(self, operation):
        if not request.httprequest.headers.get('Authorization', '').lower().startswith('bearer '):
            return request.make_json_response({'error': {'code': 'AUTH_REQUIRED', 'message': 'An explicit bearer API key is required.'}}, status=401)
        if operation not in ('context', 'describe', 'people', 'list', 'prepare', 'execute', 'result'):
            return request.make_json_response({'error': {'code': 'NOT_FOUND', 'message': 'Unknown operation.'}}, status=404)
        try:
            if request.httprequest.content_length and request.httprequest.content_length > 65536:
                return request.make_json_response({'error': {'code': 'TOO_LARGE', 'message': 'Request too large.'}}, status=413)
            data = json.loads(request.httprequest.get_data())
            if not isinstance(data, dict) or not isinstance(data.get('payload', {}), dict):
                raise ValidationError('Payload must be an object.')
            # A savepoint makes post-write verification failure roll back the whole operation.
            with request.env.cr.savepoint():
                result = getattr(request.env['odoo.work.service'], 'work_' + operation)(data.get('payload', {}))
            return request.make_json_response(result)
        except (AccessError, UserError, ValidationError, ValueError, TypeError) as error:
            return request.make_json_response({'error': {'code': 'ACCESS_DENIED' if isinstance(error, AccessError) else 'VALIDATION', 'message': str(error)}})
