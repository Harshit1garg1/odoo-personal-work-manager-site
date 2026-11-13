from odoo import Command, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestWorkService(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        group = cls.env.ref('base.group_user')
        cls.alice = cls.env['res.users'].create({'name': 'Assistant Alice', 'login': 'assistant_alice_test', 'group_ids': [Command.set([group.id])], 'company_id': cls.company.id, 'company_ids': [Command.set([cls.company.id])]})
        cls.bob = cls.env['res.users'].create({'name': 'Assistant Bob', 'login': 'assistant_bob_test', 'group_ids': [Command.set([group.id])], 'company_id': cls.company.id, 'company_ids': [Command.set([cls.company.id])]})

    def service(self, user=None):
        return self.env['odoo.work.service'].with_user(user or self.alice)

    def test_confirmed_create_is_idempotent(self):
        service = self.service()
        plan = service.work_prepare({'concept': 'todo', 'action': 'create', 'values': {'name': 'Only once'}})
        self.assertEqual(service.work_list({'concept': 'todo'})['total'], 0)
        with self.assertRaises(ValidationError):
            service.work_execute({'operation_id': plan['operation_id'], 'confirmed': False})
        args = {'operation_id': plan['operation_id'], 'confirmed': True}
        receipt = service.work_execute(args)
        self.assertEqual(receipt, service.work_execute(args))
        self.assertEqual(service.work_list({'concept': 'todo'})['total'], 1)

    def test_other_user_cannot_read_notes_or_execute_operation(self):
        plan = self.service().work_prepare({'concept': 'note', 'action': 'create', 'values': {'name': 'Private', 'body': 'Alice only'}})
        self.service().work_execute({'operation_id': plan['operation_id'], 'confirmed': True})
        self.assertEqual(self.service(self.bob).work_list({'concept': 'note', 'scope': 'accessible'})['total'], 0)
        with self.assertRaises(AccessError):
            self.service(self.bob).work_execute({'operation_id': plan['operation_id'], 'confirmed': True})

    def test_stale_preview_is_rejected(self):
        todo = self.env['odoo.work.todo'].with_user(self.alice).create({'name': 'First'})
        plan = self.service().work_prepare({'concept': 'todo', 'action': 'complete', 'record_id': todo.id})
        todo.write({'name': 'Changed'})
        with self.assertRaises(UserError):
            self.service().work_execute({'operation_id': plan['operation_id'], 'confirmed': True})
        self.assertEqual(todo.state, 'open')

    def test_native_date_readback_and_create_defaults(self):
        service = self.service()
        plan = service.work_prepare({'concept': 'todo', 'action': 'create', 'values': {'name': 'Dated item', 'deadline': '2026-11-13'}})
        self.assertEqual(plan['preview']['changes']['owner'], self.alice.id)
        self.assertEqual(plan['company_id'], self.company.id)
        receipt = service.work_execute({'operation_id': plan['operation_id'], 'confirmed': True})
        self.assertEqual(receipt['record']['deadline'], fields.Date.to_date('2026-11-13'))

    def test_standard_task_creation_and_assignment(self):
        if 'project.task' not in self.env:
            self.skipTest('Project is not installed.')
        group = self.env.ref('project.group_project_user')
        self.alice.write({'group_ids': [Command.link(group.id)]})
        project = self.env['project.project'].create({'name': 'Assistant project', 'company_id': self.company.id})
        service = self.service()
        plan = service.work_prepare({'concept': 'task', 'action': 'create', 'values': {'name': 'Assigned task', 'project': project.id, 'assignees': [self.alice.id]}})
        receipt = service.work_execute({'operation_id': plan['operation_id'], 'confirmed': True})
        self.assertEqual(receipt['record']['assignees'], [self.alice.id])
        self.assertEqual(receipt['record']['project'][0], project.id)

    def test_tampering_and_company_escalation_fail(self):
        plan = self.service().work_prepare({'concept': 'todo', 'action': 'create', 'values': {'name': 'Test'}})
        operation = self.env['odoo.work.operation'].with_user(self.alice).search([], limit=1)
        with self.assertRaises(AccessError):
            operation.write({'request_json': '{}'})
        with self.assertRaises(AccessError):
            self.service().work_context({'company_id': 999999})
        with self.assertRaises(ValidationError):
            self.service().work_prepare({'concept': 'todo', 'action': 'create', 'values': {'name': 'Bad', 'company': 999999}})

    def test_standard_timesheet_date_and_readonly_company_default(self):
        if 'hr.employee' not in self.env or 'task_id' not in self.env['account.analytic.line']._fields:
            self.skipTest('Timesheets is not installed.')
        groups = [self.env.ref('project.group_project_user'), self.env.ref('hr_timesheet.group_hr_timesheet_user')]
        self.alice.write({'group_ids': [Command.link(group.id) for group in groups]})
        self.env['hr.employee'].create({'name': 'Assistant employee', 'user_id': self.alice.id, 'company_id': self.company.id})
        project = self.env['project.project'].create({'name': 'Timesheet project', 'company_id': self.company.id, 'allow_timesheets': True})
        task = self.env['project.task'].create({'name': 'Log time here', 'project_id': project.id, 'user_ids': [Command.set([self.alice.id])]})
        service = self.service()
        plan = service.work_prepare({'concept': 'timesheet', 'action': 'create', 'values': {'name': 'Actual test work', 'date': '2026-11-13', 'project': project.id, 'task': task.id, 'hours': 1.5}})
        receipt = service.work_execute({'operation_id': plan['operation_id'], 'confirmed': True})
        self.assertEqual(receipt['record']['hours'], 1.5)
        self.assertEqual(receipt['record']['company'][0], self.company.id)

    def test_custom_field_mapping_and_completion(self):
        profile = self.env['odoo.work.profile'].create({'name': 'Custom test', 'company_id': self.company.id, 'mapping_json': '{"task":{"model":"odoo.work.todo","fields":{"name":"name","owner":"user_id","company":"company_id","phase":"state"},"editable":["name"],"owner":{"field":"owner","identity":"user"},"completion":{"field":"phase","done":["done"],"cancelled":["cancelled"]}}}'})
        todo = self.env['odoo.work.todo'].with_user(self.alice).create({'name': 'Custom task'})
        service = self.service()
        plan = service.work_prepare({'concept': 'task', 'action': 'complete', 'record_id': todo.id})
        receipt = service.work_execute({'operation_id': plan['operation_id'], 'confirmed': True})
        self.assertEqual(receipt['record']['completion'], 'done')
        self.assertEqual(todo.state, 'done')
