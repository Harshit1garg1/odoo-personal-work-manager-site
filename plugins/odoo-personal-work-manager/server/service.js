import { WorkError } from './odoo.js';

export class WorkService {
  constructor(store, client) { this.store = store; this.client = client; }
  async connect(subject, connection) {
    const context = await this.client.call(connection, 'context');
    if (!context.user?.id || context.protocol !== 1) throw new WorkError('ADDON_REQUIRED', 'Install the Odoo Work Assistant addon first.');
    this.store.put(subject, { ...connection, userId: context.user.id });
    this.store.audit(subject, 'connect', 'ok');
    return context;
  }
  async invoke(subject, operation, args = {}) {
    const connection = this.store.get(subject);
    if (!connection) throw new WorkError('NOT_CONNECTED', 'Connect your Odoo account using the secure setup page first.');
    const identity = await this.client.call(connection, 'context', { company_id: args.company_id });
    if (identity.user.id !== connection.userId) throw new WorkError('IDENTITY_CHANGED', 'The Odoo key now resolves to another user. Reconnect explicitly.');
    try {
      const result = operation === 'context' ? identity : await this.client.call(connection, operation, args);
      if (['prepare', 'execute'].includes(operation)) this.store.audit(subject, operation, 'ok');
      return result;
    } catch (error) {
      if (['prepare', 'execute'].includes(operation)) this.store.audit(subject, operation, error.code || 'error');
      throw error;
    }
  }
  disconnect(subject) { this.store.remove(subject); this.store.audit(subject, 'disconnect', 'ok'); }
}
