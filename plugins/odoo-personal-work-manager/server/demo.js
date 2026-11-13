import { randomBytes } from 'node:crypto';
import { WorkError } from './odoo.js';

const date = new Date().toISOString().slice(0, 10);
export class DemoService {
  constructor() {
    this.plans = new Map();
    this.records = {
      project: [{ id: 10, name: 'Customer portal', description: 'Refresh the client workspace', completion: 'unknown' }, { id: 11, name: 'Operations', completion: 'unknown' }],
      task: [{ id: 21, name: 'Review the portal handoff', project: [10, 'Customer portal'], assignees: [7], deadline: date, status: '01_in_progress', allocated_hours: 8, actual_hours: 3.5, completion: 'open' }, { id: 22, name: 'Confirm access for the support team', project: [11, 'Operations'], assignees: [7], deadline: date, status: '01_in_progress', allocated_hours: 2, completion: 'open' }, { id: 23, name: 'Document the release checklist', project: [10, 'Customer portal'], assignees: [7], status: '1_done', completion: 'done' }],
      timesheet: [{ id: 31, name: 'Portal review and QA', project: [10, 'Customer portal'], task: [21, 'Review the portal handoff'], date, hours: 3.5, completion: 'unknown' }],
      todo: [{ id: 41, name: 'Prepare tomorrow’s standup', deadline: date, status: 'open', completion: 'open' }],
      note: [{ id: 51, name: 'Handoff notes', body: 'Confirm accessibility checks before the release.', completion: 'unknown' }]
    };
    this.fields = {
      project: { name: 'char', description: 'text' },
      task: { name: 'char', description: 'text', project: 'many2one', assignees: 'many2many', deadline: 'date', priority: 'selection', allocated_hours: 'float' },
      timesheet: { name: 'char', date: 'date', project: 'many2one', task: 'many2one', hours: 'float' },
      todo: { name: 'char', description: 'text', deadline: 'date' }, note: { name: 'char', body: 'text' }
    };
  }
  context() { return { protocol: 1, user: { id: 7, name: 'Demo user' }, company: { id: 1, name: 'Demo workspace' }, companies: [{ id: 1, name: 'Demo workspace' }], timezone: 'UTC', source: 'DEMO — sample data only', profile_revision: 'demo-v1' }; }
  async invoke(_subject, operation, args = {}) {
    if (operation === 'context') return this.context();
    if (operation === 'people') return { records: [{ id: 7, name: 'Demo user' }, { id: 8, name: 'Alex Morgan' }], truncated: false };
    if (operation === 'describe') return { context: this.context(), capabilities: Object.fromEntries(Object.entries(this.fields).map(([concept, mapping]) => [concept, { available: true, fields: Object.fromEntries(Object.entries(mapping).map(([name, type]) => [name, { string: name.replaceAll('_', ' '), type, editable: true, required: name === 'name', ...(name === 'priority' ? { selection: [['0', 'Low'], ['1', 'Medium'], ['2', 'High']] } : {}) }])), permissions: { read: true, create: true, update: true, complete: ['task', 'todo'].includes(concept), submit: false, approve: false }, completion: ['task', 'todo'].includes(concept) ? { field: 'status', done: [concept === 'task' ? '1_done' : 'done'], cancelled: ['cancelled'] } : null }])), modules: { available: false, reason: 'Demo mode does not connect to Odoo.' } };
    if (operation === 'list') {
      const concept = args.concept || 'task', filters = args.filters || {};
      let rows = this.records[concept] || [];
      if (filters.search) rows = rows.filter(r => r.name.toLowerCase().includes(filters.search.toLowerCase()));
      if (filters.completion) rows = rows.filter(r => r.completion === filters.completion);
      if (filters.project_id) rows = rows.filter(r => (Array.isArray(r.project) ? r.project[0] : r.project) === filters.project_id);
      for (const [key, comparison] of [['date_from', 1], ['date_to', -1]]) if (filters[key]) rows = rows.filter(r => { const d = r.date || r.deadline; return d && (comparison === 1 ? d >= filters[key] : d <= filters[key]); });
      const offset = args.offset || 0, limit = args.limit || 50;
      const known = ['task', 'todo'].includes(concept);
      return { concept, records: structuredClone(rows.slice(offset, offset + limit)), total: rows.length, offset, next_offset: offset + limit < rows.length ? offset + limit : null, summary: { open: known ? rows.filter(r => r.completion === 'open').length : null, done: known ? rows.filter(r => r.completion === 'done').length : null, cancelled: known ? rows.filter(r => r.completion === 'cancelled').length : null, hours: concept === 'timesheet' ? rows.reduce((n, r) => n + r.hours, 0) : null }, filters, scope: args.scope || 'mine', company_id: 1, timezone: 'UTC', as_of: new Date().toISOString(), source: 'DEMO' };
    }
    if (operation === 'prepare') {
      if (!this.records[args.concept]) throw new WorkError('VALIDATION', 'Unknown concept.');
      if (!['create', 'update', 'complete'].includes(args.action)) throw new WorkError('VALIDATION', 'This action needs a real mapped workflow.');
      if (Object.keys(args.values || {}).some(k => !this.fields[args.concept][k])) throw new WorkError('VALIDATION', 'Field is not editable.');
      const before = args.action === 'create' ? null : this.records[args.concept].find(r => r.id === args.record_id);
      if (args.action !== 'create' && !before) throw new WorkError('NOT_FOUND', 'Record does not exist.');
      if (args.action === 'create' && !args.values?.name) throw new WorkError('VALIDATION', 'Name is required.');
      if (args.concept === 'timesheet') {
        const merged = { ...before, ...args.values };
        if (!merged.name || !merged.date || !merged.project || typeof merged.hours !== 'number' || merged.hours <= 0 || merged.hours > 24) throw new WorkError('VALIDATION', 'Timesheets need a description, date, project and hours greater than zero and at most 24.');
      }
      const token = randomBytes(24).toString('hex');
      const preview = { concept: args.concept, action: args.action, record_id: args.record_id, before: structuredClone(before), changes: args.action === 'complete' ? { completion: 'done' } : args.values, acting_user: 'Demo user', company: 'Demo workspace', side_effects: 'Sample data only. Nothing is sent to Odoo.', expires_in_seconds: 600 };
      this.plans.set(token, { args: structuredClone(args), preview, before: JSON.stringify(before), expires: Date.now() + 600000 });
      return { operation_id: token, company_id: 1, preview, requires_confirmation: true };
    }
    const plan = this.plans.get(args.operation_id);
    if (!plan) throw new WorkError('NOT_FOUND', 'Unknown operation.');
    if (operation === 'result') return plan.response || { status: 'prepared', preview: plan.preview, expired: plan.expires < Date.now() };
    if (operation !== 'execute' || args.confirmed !== true) throw new WorkError('CONFIRMATION_REQUIRED', 'Confirm the exact preview.');
    if (plan.response) return plan.response;
    if (plan.expires < Date.now()) throw new WorkError('EXPIRED', 'Prepare a new preview.');
    const input = plan.args, rows = this.records[input.concept];
    let record = rows.find(r => r.id === input.record_id);
    if (input.action !== 'create' && JSON.stringify(record) !== plan.before) throw new WorkError('CONFLICT', 'The record changed. Prepare a new preview.');
    if (input.action === 'create') { record = { id: Math.max(100, ...rows.map(r => r.id)) + 1, completion: ['todo', 'task'].includes(input.concept) ? 'open' : 'unknown', ...input.values }; rows.unshift(record); }
    else if (input.action === 'complete') { record.completion = 'done'; record.status = input.concept === 'task' ? '1_done' : 'done'; }
    else Object.assign(record, input.values);
    plan.response = { status: 'verified', concept: input.concept, action: input.action, record: structuredClone(record), acting_user: 'Demo user', company_id: 1 };
    return plan.response;
  }
}
