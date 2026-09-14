import {index, integer, primaryKey, sqliteTable, text} from 'drizzle-orm/sqlite-core';

export const appDocuments = sqliteTable(
  'app_documents',
  {
    ownerId: text('owner_id').notNull(),
    collection: text('collection').notNull(),
    documentId: text('document_id').notNull(),
    payload: text('payload').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({columns: [table.ownerId, table.collection, table.documentId]}),
    index('idx_app_documents_owner_collection').on(table.ownerId, table.collection),
  ],
);

export const syncRevisions = sqliteTable('sync_revisions', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
