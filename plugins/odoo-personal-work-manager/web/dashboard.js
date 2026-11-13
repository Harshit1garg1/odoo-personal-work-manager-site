import { App } from '@modelcontextprotocol/ext-apps';

const $ = id => document.getElementById(id);
const labels = { task: 'Tasks', project: 'Projects', timesheet: 'Timesheets', todo: 'Todos', note: 'Notes' };
let state = { concept: 'task', offset: 0, company_id: undefined, scope: 'mine', filters: {}, limit: 20 };
let discovery, page, editing, plan, busy = false, app;
const embedded = window.parent !== window;
const toolNames = { discover: 'discover_odoo', list: 'list_work', prepare: 'prepare_work_change', execute: 'execute_work_change', result: 'get_work_change_result', people: 'list_assignable_people' };

function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').className = error ? 'error' : ''; }
function text(value) {
  if (value === false || value == null || value === '') return '—';
  if (Array.isArray(value)) return value.length === 2 && typeof value[1] === 'string' ? value[1] : value.join(', ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function element(tag, value, className) { const el = document.createElement(tag); if (value != null) el.textContent = value; if (className) el.className = className; return el; }
function currentCapability() { return discovery?.capabilities?.[state.concept]; }
async function call(operation, args = {}) {
  if (app) {
    const result = await app.callServerTool({ name: toolNames[operation], arguments: args });
    if (result.isError) {
      let value; try { value = JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}'); } catch {}
      throw new Error(value?.message || result.content?.[0]?.text || 'Odoo rejected the request.');
    }
    return result.structuredContent || JSON.parse(result.content.find(c => c.type === 'text').text);
  }
  const token = sessionStorage.getItem('odoo-work-token');
  const response = await fetch(`/api/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message || 'The request failed.');
  return result;
}
async function run(action) {
  if (busy) return;
  busy = true; $('refresh').disabled = true; $('confirm').disabled = true; $('create').disabled = true;
  try { await action(); } catch (error) { feedback(error.message, true); }
  finally { busy = false; $('refresh').disabled = false; $('confirm').disabled = false; $('create').disabled = false; }
}
async function discover() {
  discovery = await call('discover', { company_id: state.company_id });
  const context = discovery.context;
  state.company_id = context.company.id;
  $('company').replaceChildren(...context.companies.map(c => { const option = element('option', c.name); option.value = c.id; return option; }));
  $('company').value = String(state.company_id);
  $('source').textContent = `${context.company.name} · ${context.user.name} · ${context.source || 'Odoo'}`;
  $('timezone').textContent = `Dates: ${context.timezone}`;
  $('demo-banner').hidden = !context.source?.startsWith('DEMO');
  $('capabilities').replaceChildren(...Object.entries(discovery.capabilities).map(([key, capability]) => element('p', capability.available ? `${labels[key]}: available · ${Object.entries(capability.permissions).filter(([, allowed]) => allowed).map(([name]) => name).join(', ')}${!capability.completion && ['task', 'project', 'todo'].includes(key) ? ' · Completion meaning is not configured.' : ''}` : `${labels[key]}: ${capability.reason}`)));
  for (const button of document.querySelectorAll('[data-concept]')) { const capability = discovery.capabilities[button.dataset.concept]; button.title = capability.available ? '' : capability.reason; }
}
async function load() {
  $('records').replaceChildren(); $('summary').textContent = 'Loading your work…';
  const capability = currentCapability();
  $('create').hidden = !capability?.available || !capability.permissions.create;
  $('create').textContent = `Add ${state.concept}`;
  $('completion').disabled = !capability?.completion;
  const dateMapped = capability?.fields?.date || capability?.fields?.deadline;
  $('date-from').disabled = $('date-to').disabled = !dateMapped;
  $('section-title').textContent = labels[state.concept];
  for (const button of document.querySelectorAll('[data-concept]')) { if (button.dataset.concept === state.concept) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  if (!capability?.available) { $('summary').textContent = capability?.reason || 'This capability is unavailable.'; $('table-wrap').hidden = true; $('empty').hidden = true; $('range').textContent = ''; $('previous').disabled = $('next').disabled = true; return; }
  page = await call('list', state);
  render();
}
function render() {
  const capability = currentCapability(), rows = page.records;
  $('summary').textContent = `${page.total} ${labels[state.concept].toLowerCase()}${page.summary.open !== null ? ` · ${page.summary.open} open · ${page.summary.done} done · ${page.summary.cancelled} cancelled` : ['task', 'project', 'todo'].includes(state.concept) ? ' · Completion meaning not configured' : ''}${page.summary.hours !== null ? ` · ${Number(page.summary.hours).toLocaleString(undefined, { maximumFractionDigits: 2 })} hours logged` : ''}`;
  $('caption').textContent = `${labels[state.concept]}, ${state.scope === 'mine' ? 'my work' : 'all accessible work'}`;
  const columns = state.concept === 'timesheet' ? ['name', 'date', 'project', 'hours'] : state.concept === 'note' ? ['name', 'body'] : state.concept === 'task' ? ['name', 'project', 'deadline', 'allocated_hours', 'actual_hours', 'remaining_hours', 'completion'] : ['name', 'project', 'deadline', 'completion'];
  const columnLabels = { allocated_hours: 'Allocated h', actual_hours: 'Logged h (total)', remaining_hours: 'Remaining h' };
  const header = element('tr'); columns.forEach(c => header.append(element('th', columnLabels[c] || (c === 'name' ? 'Title' : c[0].toUpperCase() + c.slice(1))))); header.append(element('th', 'Actions')); $('table-head').replaceChildren(header);
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = element('tr');
    for (const column of columns) {
      const td = element('td', null, column === 'name' ? 'title-cell' : ['date', 'deadline', 'hours', 'allocated_hours', 'actual_hours', 'remaining_hours'].includes(column) ? 'nowrap' : '');
      if (column === 'completion') td.append(element('span', row.completion === 'unknown' ? 'Not mapped' : row.completion, `badge ${row.completion}`));
      else { td.textContent = text(row[column]); if (column === 'name') td.append(element('div', `#${row.id}`, 'secondary')); }
      tr.append(td);
    }
    const actions = element('td', null, 'actions');
    const actionButton = (label, action) => { const button = element('button', label); button.type = 'button'; button.addEventListener('click', () => run(action)); actions.append(button); };
    if (capability.permissions.update) actionButton('Edit', () => openEditor(row));
    if (capability.permissions.complete && row.completion !== 'done' && row.completion !== 'cancelled') actionButton('Mark done', () => prepare({ concept: state.concept, action: 'complete', record_id: row.id }));
    for (const action of ['submit', 'approve']) if (capability.permissions[action]) actionButton(action === 'submit' ? 'Submit' : 'Approve', () => prepare({ concept: state.concept, action, record_id: row.id }));
    if (!actions.childNodes.length) actions.textContent = 'Read only';
    tr.append(actions); fragment.append(tr);
  }
  $('records').replaceChildren(fragment); $('table-wrap').hidden = !rows.length; $('empty').hidden = !!rows.length;
  $('range').textContent = rows.length ? `${page.offset + 1}–${page.offset + rows.length} of ${page.total} · Updated ${new Date(page.as_of.replace(' ', 'T') + (page.as_of.includes('Z') || page.as_of.includes('+') ? '' : 'Z')).toLocaleTimeString()}` : '0 records';
  $('previous').disabled = page.offset === 0; $('next').disabled = page.next_offset === null;
}
async function openEditor(row = null) {
  editing = row; $('fields').replaceChildren(); $('preview').hidden = true; plan = null;
  $('editor-title').textContent = row ? `Edit ${state.concept} #${row.id}` : `Add ${state.concept}`;
  const fields = currentCapability().fields;
  let projects = [], tasks = [], people = [];
  if (fields.project) { try { projects = (await call('list', { concept: 'project', scope: 'accessible', company_id: state.company_id, limit: 100, offset: 0, filters: {} })).records; } catch {} }
  if (fields.task) { try { tasks = (await call('list', { concept: 'task', scope: 'accessible', company_id: state.company_id, limit: 100, offset: 0, filters: {} })).records; } catch {} }
  if (fields.assignees) { try { people = (await call('people', { company_id: state.company_id, search: '', limit: 100 })).records; } catch {} }
  for (const [name, field] of Object.entries(fields)) {
    if (!field.editable) continue;
    const label = element('label', field.string || name);
    let input;
    const options = name === 'project' ? projects : name === 'task' ? tasks : name === 'assignees' ? people : [];
    if (field.type === 'selection' || options.length) {
      input = document.createElement('select');
      if (field.type === 'many2many') { input.multiple = true; input.size = 4; }
      else { const none = element('option', 'Select…'); none.value = ''; input.append(none); }
      const choices = field.selection || options.map(r => [r.id, `${r.name} (#${r.id})`]);
      for (const [value, title] of choices) { const option = element('option', title); option.value = value; input.append(option); }
      // Keep current relations even when they are outside the first directory page.
      const existing = field.type === 'many2many' ? (row?.[name] || []).map(id => [id, `Current assignee (#${id})`]) : field.type === 'many2one' && Array.isArray(row?.[name]) ? [row[name]] : [];
      for (const [value, title] of existing) if (![...input.options].some(o => o.value === String(value))) { const option = element('option', title); option.value = value; input.append(option); }
    } else if (['text', 'html'].includes(field.type)) input = document.createElement('textarea');
    else { input = document.createElement('input'); input.type = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : ['float', 'integer', 'many2one', 'monetary'].includes(field.type) ? 'number' : field.type === 'boolean' ? 'checkbox' : 'text'; if (input.type === 'number') input.step = field.type === 'integer' || field.type === 'many2one' ? '1' : 'any'; if (field.type === 'many2many') input.placeholder = 'Odoo user IDs, separated by commas'; }
    input.name = name; input.dataset.kind = field.type;
    input.required = !row && (!!field.required || state.concept === 'timesheet' && ['name', 'date', 'project', 'hours'].includes(name));
    if (field.type === 'boolean') input.checked = !!row?.[name];
    else if (input.multiple) for (const option of input.options) option.selected = (row?.[name] || (name === 'assignees' ? [discovery.context.user.id] : [])).includes(Number(option.value));
    else input.value = row?.[name] === false || row?.[name] == null ? name === 'date' ? new Date().toLocaleDateString('en-CA') : '' : field.type === 'many2one' && Array.isArray(row[name]) ? row[name][0] : Array.isArray(row[name]) ? row[name].join(',') : row[name];
    if (field.type === 'datetime') { input.value = row?.[name] ? String(row[name]).replace(' ', 'T').slice(0, 19) : ''; label.append(element('small', 'Datetime values use UTC. Date-range filters use your Odoo timezone.')); }
    input.dataset.original = JSON.stringify(input.multiple ? [...input.selectedOptions].map(o => Number(o.value)) : input.type === 'checkbox' ? input.checked : input.value);
    label.append(input);
    if (['many2one', 'many2many'].includes(field.type)) label.append(element('small', options.length ? 'First 100 accessible choices. Use chat to find other records by name.' : 'Use a verified Odoo record ID. Ask in chat to look it up.'));
    $('fields').append(label);
  }
  $('editor').hidden = false; $('editor').scrollIntoView({ behavior: 'instant', block: 'start' }); $('fields').querySelector('input,select,textarea')?.focus();
}
function formValues() {
  const values = {};
  for (const input of $('fields').querySelectorAll('input,select,textarea')) {
    const kind = input.dataset.kind;
    let value = input.type === 'checkbox' ? input.checked : input.multiple ? [...input.selectedOptions].map(o => Number(o.value)) : input.value;
    if (editing && JSON.stringify(value) === input.dataset.original) continue;
    if (value === '' && !editing) continue;
    if (kind === 'many2many' && !input.multiple) value = value ? value.split(',').map(x => Number(x.trim())) : [];
    if (['float', 'integer', 'many2one', 'monetary'].includes(kind)) value = value === '' ? false : Number(value);
    if (value === '' && ['date', 'datetime', 'selection'].includes(kind)) value = false;
    if (kind === 'datetime' && value) value = value.replace('T', ' ');
    const old = editing?.[input.name];
    const normalizedOld = kind === 'many2one' && Array.isArray(old) ? old[0] : old;
    if (!editing || JSON.stringify(value) !== JSON.stringify(normalizedOld ?? (kind === 'boolean' ? false : kind === 'many2many' ? [] : ''))) values[input.name] = value;
  }
  return values;
}
function showPreview(result) {
  plan = { ...result, company_id: result.company_id ?? state.company_id };
  const preview = result.preview;
  $('preview-context').textContent = `${preview.action} ${preview.concept}${preview.record_id ? ` #${preview.record_id}` : ''} · ${preview.company} · Acting as ${preview.acting_user} · Expires in 10 minutes`;
  $('preview-fields').replaceChildren(...Object.entries(preview.changes).map(([key, value]) => { const tr = element('tr'); tr.append(element('td', key), element('td', text(preview.before?.[key])), element('td', text(value))); return tr; }));
  $('side-effects').textContent = preview.side_effects; $('recover').hidden = true; $('preview').hidden = false;
  $('preview').scrollIntoView({ behavior: 'instant', block: 'start' }); $('confirm').focus();
}
async function prepare(args) { showPreview(await call('prepare', { ...args, company_id: state.company_id })); }
async function saved(result) {
  $('preview').hidden = $('editor').hidden = true; plan = null;
  feedback(`${result.action} saved and verified · ${result.concept} #${result.record.id} · ${result.acting_user}`);
  await load();
}
$('record-form').addEventListener('submit', event => { event.preventDefault(); run(() => prepare({ concept: state.concept, action: editing ? 'update' : 'create', ...(editing ? { record_id: editing.id } : {}), values: formValues() })); });
$('confirm').addEventListener('click', () => run(async () => { if (!plan) return; try { await saved(await call('execute', { company_id: plan.company_id, operation_id: plan.operation_id, confirmed: true })); } catch (error) { $('recover').hidden = false; throw error; } }));
$('recover').addEventListener('click', () => run(async () => { const result = await call('result', { company_id: plan.company_id, operation_id: plan.operation_id }); if (result.status === 'verified') await saved(result); else feedback(result.expired ? 'This preview expired. Cancel and review a new change.' : 'No saved receipt yet. Confirming this same preview again is safe; it uses the same operation ID.'); }));
$('cancel').addEventListener('click', () => { plan = null; $('preview').hidden = true; });
$('close-editor').addEventListener('click', () => { $('editor').hidden = true; });
$('create').addEventListener('click', () => run(() => openEditor()));
$('refresh').addEventListener('click', () => run(async () => { await discover(); await load(); feedback('Refreshed from the current data source.'); }));
$('company').addEventListener('change', () => run(async () => { state.company_id = Number($('company').value); state.offset = 0; $('editor').hidden = $('preview').hidden = true; plan = null; await discover(); await load(); }));
$('scope').addEventListener('change', () => run(async () => { state.scope = $('scope').value; state.offset = 0; await load(); }));
$('filters').addEventListener('submit', event => { event.preventDefault(); run(async () => { const filters = {}; for (const [id, key] of [['search', 'search'], ['completion', 'completion'], ['date-from', 'date_from'], ['date-to', 'date_to']]) if (!$(id).disabled && $(id).value) filters[key] = $(id).value; if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) throw new Error('The start date must be before the end date.'); state.filters = filters; state.offset = 0; await load(); }); });
for (const button of document.querySelectorAll('[data-concept]')) button.addEventListener('click', () => run(async () => { feedback(''); state.concept = button.dataset.concept; state.offset = 0; state.filters = {}; $('filters').reset(); $('editor').hidden = $('preview').hidden = true; plan = null; await load(); }));
$('next').addEventListener('click', () => run(async () => { state.offset = page.next_offset; await load(); }));
$('previous').addEventListener('click', () => run(async () => { state.offset = Math.max(0, state.offset - state.limit); await load(); }));
await run(async () => {
  if (embedded) {
    $('account').hidden = true;
    app = new App({ name: 'Odoo Work', version: '0.2.0' }, {}, { autoResize: true });
    app.ontoolresult = result => {
      const data = result.structuredContent;
      if (data?.preview && data.operation_id) showPreview(data);
      else if (data?.status === 'verified') feedback(`Saved and verified · ${data.concept} #${data.record.id}`);
      else if (data?.records && data.concept) { state = { ...state, concept: data.concept, offset: data.offset, company_id: data.company_id, scope: data.scope, filters: data.filters || {} }; if (data.discovery) discovery = data.discovery; page = data; if (discovery) render(); }
    };
    await app.connect();
  }
  await discover(); await load();
});
